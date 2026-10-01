# Estado del proyecto

> **Este es el documento de referencia.** Otros `.md` de la raíz son históricos y contienen
> URLs de infraestructura que ya no existe. Si alguno contradice esto, gana esto.

Última actualización: **2026-10-01**

---

## Accesos

| Qué | Dónde |
|---|---|
| **App en producción** | `https://tarjeta-fidelizacion.kstriyhon-ded.workers.dev` |
| **Supabase** | `https://mpckfsufmznziqrhrxai.supabase.co` |
| Repo | `github.com/kstriyhon/fidelizacion` · rama `main` |
| Cuenta Cloudflare | `kstriyhon@protonmail.com` |
| Desplegar | `npm run deploy` (build + wrangler, ~3-5 min) |

### ⚠️ Infraestructura muerta — no usar

Sigue en línea y **parece** funcionar, pero apunta a proyectos de Supabase que ya no
existen. Entrar ahí produce un `TypeError: Failed to fetch` al iniciar sesión:

- `tarjeta-fidelizacion.idatech.workers.dev` — Worker viejo, en otra cuenta de Cloudflare
- Proyectos Supabase `solasuxfnoipziijibam`, `zkecrbagxwewtubnusls`, `mpckcsfumfznziqrhrxai`

El último es un **error tipográfico** del proyecto bueno: fíjate en `f-s-u-f`, no `c-s-f-u-m-f`.

---

## Los dos sistemas de login

Es la fuente número uno de confusión en este proyecto.

| Ruta | Quién entra | Con qué | Tabla |
|---|---|---|---|
| `/login` | Dueño de la plataforma | **email** + contraseña | Supabase Auth |
| `/p/{slug}` | El comercio cliente | **usuario** + contraseña | `business_access_credentials` |

- Los comercios **nunca** se registran en `/login`: Supabase Auth exige email porque es la
  identidad. Hoy existe **un solo** usuario de Supabase y **todos los negocios le pertenecen**.
- A cada comercio se le configuran credenciales desde el panel, botón **"⚙ Credenciales"**
  (requiere admin).
- El login de `/p/{slug}` emite un **token HMAC firmado** (`src/lib/businessSession.server.ts`),
  prefijo `fb1.`, válido 12 h. La clave se deriva de `SUPABASE_SERVICE_ROLE_KEY`: no hay
  secreto aparte que configurar, y rotar esa key invalida todas las sesiones.

### Cómo se autoriza

Todo pasa por `requireBusinessAccess` (`src/lib/authz.server.ts`), que acepta las dos
sesiones y ata la de negocio a **un único** `businessId`. Como `requireProgramAccess` y
`requireMemberAccess` pasan por ahí, dar sellos y canjear funcionan con ambas.

`getAccessToken()` (`src/lib/auth.ts`) devuelve el token que toque. **Si añades una llamada
nueva en el panel, úsalo y funcionará con los dos tipos de sesión.**

---

## Convenciones que hay que respetar

**Las migraciones se corren a mano** en el dashboard de Supabase. No se aplican solas.
Aplicadas hasta la **0017** (la 0016 quedó sin efecto, ver abajo).

**Nunca `select("*")` sobre `loyalty_programs`.** Esa tabla guarda credenciales de Google
Wallet. Usa `PROGRAM_CLIENT_COLUMNS` (`src/lib/data.ts`) en todo lo que vaya al navegador.
Esa lista y el `grant` de la migración 0017 **deben coincidir**: si añades una columna que
el cliente necesite, va en los dos sitios o `/unirse/{slug}` deja de cargar.

**Hashing: PBKDF2, no bcrypt.** bcrypt es un binding nativo y no carga en Cloudflare
Workers — compila en local y revienta en producción. Ver `src/lib/password.server.ts`.

**`npx tsc --noEmit` da 14 errores preexistentes** sobre Google Wallet y el tipo `Program`.
Es la baseline: si salen 14, no has roto nada.

Todos son la misma causa: `getWalletConfigForProgram(program)` recibe un `Program` cuyo
tipo no declara las columnas `google_wallet_*`. **En ejecución funciona** —esas rutas cargan
el programa con `select("*")`—, es el tipo el que miente. Cada llamada nueva suma un error
más. Conviene limpiarlo algún día: mientras siga así, esos 14 son ruido que puede tapar un
error de verdad.

---

## Comprobaciones rápidas

```bash
# ¿A qué Supabase apunta un despliegue? (detecta builds viejos)
curl -sS https://<host>/login | grep -ao 'assets/index-[^"]*\.js'
# ...y busca <ref>.supabase.co dentro de ese .js

# Consultar la BD (desde la raíz del repo; .dev.vars no está en git)
K=$(grep SUPABASE_SERVICE_ROLE_KEY .dev.vars | sed 's/^[^=]*=//' | tr -d '"'"'"' \r')
curl -sS "https://mpckfsufmznziqrhrxai.supabase.co/rest/v1/loyalty_businesses?select=name,slug,id" \
  -H "apikey: $K" -H "Authorization: Bearer $K"
```

---

## Alta de comercios (self-service)

Página pública **`/planes`** con los precios reales de la BD. El comercio elige plan →
`/login?plan=…&nuevo=true` (abre en registro) → `Onboarding` en `/comercio` crea negocio,
programa **y suscripción**.

⚠️ `createBusinessFn` **debe** crear la suscripción. Sin ella `validatePlanLimits` bloquea
la inscripción de clientes, y el fallo solo aparece cuando un cliente final escanea el QR:
estuvo quince días bloqueando inscripciones sin que nada avisara.

**No hay cobro.** Cualquiera puede registrarse y queda activo con el plan que elija; las
facturas se generan y marcan pagadas a mano desde `/admin`.

## Panel en móvil

La mayoría de comercios lo usan desde el celular. Decisiones tomadas midiendo en 375px:

- El QR de inscripción va **plegado** arriba. Desplegado ocupa ~400px y empujaba la lista
  de clientes fuera de la primera pantalla; dar sellos es lo que más se hace.
- Las etiquetas de los botones **no se ocultan** en pantalla estrecha. Antes lo hacían para
  caber en una línea y quedaban iconos sin nombre accesible.
- Objetivos táctiles de 44px en móvil (`h-11 ... sm:h-9`).
- El bloque **"Tu plan"** muestra plan, precio y consumo con aviso al 80%.

## Historial de sellos

**Ya existía y nadie lo sabía:** `loyalty_stamp_events` guarda cada sello y cada canje
desde la migración `0001`, y `addStampFn`/`redeemRewardFn` siempre han escrito ahí. Al
añadir la vista, el historial de los sellos ya dados apareció entero — no empezó a contar
desde cero.

En el panel, la línea "N/M sellos · P premios" de cada cliente despliega sus movimientos
(`getMemberHistoryFn`, bajo demanda, no con la carga del panel).

**Quitar un sello** (menú ⋮ del cliente) registra un `adjust` con `delta -1` y **no borra**
el evento original: el historial debe contar lo que pasó, no fingir que no ocurrió. Y
actualiza el pase **sin mensaje** — corregir un error del comercio no justifica notificar
al cliente, y menos con un "¡Nuevo sello!".

## ⚠️ Notificaciones push: leer antes de "arreglar" nada

Dos sistemas independientes, con fallos y límites distintos. Un día entero se fue en
confundirlos.

**Google Wallet — funciona, pero NO es instantáneo.** Tarda **~1 minuto**. Eso es normal;
no es un fallo. Y el límite real importa:

> Google entrega **3 notificaciones por tarjeta cada 24 h**. Pasado eso **no las rechaza**:
> las encola y llegan horas después, todas juntas. Además avisa de que puede recortar la
> cuota del emisor si considera que abusa.

El límite es **por cliente, no por negocio**: si 50 clientes ganan un sello, los 50 reciben
su aviso. `puedeNotificar()` en `loyaltyActions.ts` cuenta los sellos y canjes de las
últimas 24 h y, a partir del tercero, manda el mensaje como `TEXT` en vez de
`TEXT_AND_NOTIFY` — aparece en la tarjeta al momento, sin gastar cuota.

Los mensajes que el comercio escribe a mano **no se cuentan** (no quedan en
`loyalty_stamp_events`). Son deliberados y poco frecuentes; si se vuelven habituales habría
que registrarlos.

**Al diagnosticar, no se puede probar a base de sellos seguidos:** se quema la cuota y todo
parece roto. Usa una tarjeta sin actividad en 24 h, un solo sello, y espera dos minutos.

**Apple Wallet — estuvo roto semanas sin que nada avisara.** `loyalty_device_registrations`
quedó incompleta al migrar de proyecto Supabase: faltaban `device_library_identifier` y
`registered_at`, el upsert fallaba, el endpoint devolvía 500 y **ningún iPhone llegó a
registrarse**. Sin token no hay a dónde notificar. Lo arregla la migración `0018`.

Lo ocultó que `syncApplePass` captura sus errores y solo hace `console.warn` — a propósito,
para que un fallo de Apple no impida dar el sello, pero eso también silencia el problema.
**Si Apple deja de notificar, lo primero es mirar si `loyalty_device_registrations` tiene
filas.**

Para probar el registro sin un iPhone: leer el `.pkpass` de `loyalty_apple_passes`
(columna `signature`, bytea), sacar su `authenticationToken` y hacer el POST a
`/api/passkit/v1/devices/{id}/registrations/{passType}/{serial}`. Debe dar **201**.

## Pases de Wallet

Los sellos salen como saldo numérico (`3/10`) **y** como fila de círculos (`●●●○○○○○○○`),
en Google y en Apple. La fila se arma en `src/lib/wallet/dots.ts`.

⚠️ **Google reemplaza `textModulesData` entero en cada PATCH.** Por eso `buildTextModules`
se usa al crear el pase Y en cada actualización, y el PATCH reenvía el módulo del premio
aunque no cambie. Si se tocara solo uno de los dos sitios, la fila se congelaría mientras
el saldo avanza.

Se omite la fila por encima de 12 sellos: no se lee de un vistazo y el número es exacto.

**Los pases ya emitidos no se refrescan solos:** cada uno se actualiza en su próximo sello.

## Pendiente

Al 2026-10-01. Lo de arriba (ocultar botones al cliente, self-service, página de planes)
**ya está hecho** — si alguien lo lee como pendiente, está mirando una versión vieja.

**1. Dar acceso propio a bugayork y a asados el uruguayo.** Solo `2x1 el original` tiene
credenciales (`original2x1`). Los otros dos dependen de que entre el dueño de la plataforma.
Se configura en el panel → elegir el comercio en el desplegable → **⚙ Credenciales**. Diez
minutos, y es lo que más valor da: deja a esos dos comercios autónomos.

**2. Borrar el Worker viejo `tarjeta-fidelizacion.idatech.workers.dev`.** Sigue en línea
sirviendo un build muerto que apunta a un Supabase inexistente. Está en la cuenta de
Cloudflare `idatech@protonmail.com`, así que tiene que entrar el usuario.

**3. KV no está declarado en `wrangler.jsonc`.** `getKVCache()` en `google.server.ts`
siempre devuelve `null`, así que el "caché de tokens en KV" del commit `b02bbd3` (14-sep) es
código muerto; solo funciona el caché en memoria. No rompe nada —hay respaldo— pero el
código promete algo que no ocurre. O se declara el namespace, o se quita esa rama.

**4. Pasarela de pago**, si se abre el registro al público. Hoy cualquiera se registra en
`/planes` y su comercio queda activo **sin pagar**; las facturas se generan y se marcan como
pagadas a mano desde `/admin`. Wompi, ePayco o Mercado Pago. Son varias sesiones:
credenciales, webhooks, qué pasa cuando un cobro falla y qué se hace con un moroso.

**5. Menor:** la consola de Google Wallet acumula **25 clases**, algunas de programas ya
borrados (se crea una por programa y no se limpian). No molesta, pero ensucia.

---

## Dos trampas que ya costaron horas

**`Failed to fetch` casi nunca es un problema de credenciales.** Comprueba primero **en qué
host** está la persona: hay un Worker viejo, en otra cuenta, sirviendo un build que apunta
a un Supabase inexistente. Falla igual en incógnito, así que descartar caché no descarta
nada. Señal rápida: si el formulario de login **no** muestra "¿Olvidaste tu contraseña?"
ni el ojo de mostrar contraseña, es el build viejo.

**`REVOKE SELECT (columnas)` no hace nada en Postgres** si existe un `GRANT SELECT` sobre
la tabla, y Supabase se lo concede a `anon`. Hay que quitar el de tabla y conceder columnas:

```sql
revoke select on public.<tabla> from anon, authenticated;
grant  select (col1, col2, ...) on public.<tabla> to anon, authenticated;
```

Comparar `supabase/migrations/0016` (inocua) con la `0017` (la que funciona).

**Y en general:** al verificar algo, comprueba también que **falle donde debe fallar**. Las
dos equivocaciones de arriba las destapó el control negativo, no la prueba positiva.

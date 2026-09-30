# Estado del proyecto

> **Este es el documento de referencia.** Otros `.md` de la raíz son históricos y contienen
> URLs de infraestructura que ya no existe. Si alguno contradice esto, gana esto.

Última actualización: **2026-09-28**

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

**`npx tsc --noEmit` da 13 errores preexistentes** sobre Google Wallet y el tipo `Program`.
Es la baseline: si salen 13, no has roto nada.

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

## Pendiente

1. **Ocultar al cliente** de `/p/{slug}` los botones "Editar", "Nuevo programa" y
   "Credenciales" en `comercio.tsx`. El servidor bloquea el último (`requireAdmin`), pero
   los ve. `requireBusinessAccess` ya devuelve `viaBusinessSession` para distinguirlo.
2. **Borrar el Worker `idatech`** — está en la cuenta `idatech@protonmail.com`.
3. **Registro self-service** de comercios (página pública de planes + alta automática).

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

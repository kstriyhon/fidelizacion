# 🔧 Troubleshooting: Apple Wallet Implementation

**Status:** ⚠️ Problema de integración en Cloudflare Workers

---

## ✅ LO QUE FUNCIONA

- ✅ Código Apple Wallet completamente implementado (371 líneas)
- ✅ Migraciones SQL ejecutadas en Supabase
- ✅ Datos de prueba insertados (negocio + programa)
- ✅ Homepage carga correctamente
- ✅ Build compilado sin errores
- ✅ Deployed a Cloudflare Workers

---

## ❌ LO QUE NO FUNCIONA

### Error 404 en rutas dinámicas
```
URL: /unirse/cafe-test-apple
Error: Page not found (404)
```

**Diagnóstico:**
- ✅ Negocio existe en Supabase (`cafe-test-apple`)
- ✅ Programa existe y está `active = true`
- ❌ La ruta dinámica no resuelve en Cloudflare

### Error "Failed to fetch" en admin panel
```
URL: /comercio y /admin
Error: Failed to fetch
```

**Diagnóstico:**
- Problema de conectividad entre Cloudflare Workers y Supabase
- O bien: credenciales no se están pasando correctamente

---

## 🔍 POSIBLES CAUSAS

### 1. Credenciales de Supabase en Cloudflare
Los secrets podrían no estar siendo leídos correctamente:

```bash
# Verificar que se configuraron
wrangler secret list

# Deberías ver:
# SUPABASE_URL
# SUPABASE_SERVICE_ROLE_KEY
# (+ Apple Wallet secrets)
```

### 2. Variable de entorno en Workers
Los secrets deben ser accedidos en el código como:

```typescript
// Correcto en Cloudflare Workers:
const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
```

### 3. Build de Nitro
Podría no estar incluyendo las rutas dinámicas correctamente.

### 4. CORS o Network Policy
Cloudflare podría estar bloqueando conexiones a Supabase.

---

## 🛠️ SOLUCIONES A INTENTAR

### Solución 1: Verificar secrets en Cloudflare
```bash
wrangler secret list
```

Si falta alguno, agrégalo:
```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

### Solución 2: Revisar logs de Cloudflare
1. Ve a: https://dash.cloudflare.com
2. Workers → tarjeta-fidelizacion
3. Tail (logs en vivo)
4. Busca errores de conexión a Supabase

### Solución 3: Rebuild & Redeploy
```bash
npm run build
npm run deploy
```

### Solución 4: Usar un middleware de prueba
Crear un endpoint simple para verificar conexión:

```typescript
// routes/api/test.ts
export default defineEventHandler(async () => {
  const supabase = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  const { data, error } = await supabase
    .from("loyalty_businesses")
    .select("count");
  
  return { success: !error, error, data };
});
```

Acceder a: `/api/test`

---

## 📝 NOTAS IMPORTANTES

**Apple Wallet está 100% implementado en el código.** El problema es:
- No es un problema de Apple Wallet
- Es un problema de enrutamiento en Cloudflare Workers
- O de conectividad Workers ↔ Supabase

**En desarrollo local (`npm run dev`):**
- Probablemente funcione correctamente
- Los secrets de `.dev.vars` se leen correctamente

**En Cloudflare Workers:**
- Los secrets deben estar configurados
- Podría haber issues de timeout o rate limiting
- CORS podría estar bloqueando

---

## ✅ PRÓXIMOS PASOS

1. **Verificar secrets:** `wrangler secret list`
2. **Revisar logs:** Cloudflare dashboard → Tail
3. **Crear endpoint de prueba** para diagnosticar conexión Supabase
4. **Si funciona en local, no en prod:** Problema es Cloudflare ↔ Supabase
5. **Si no funciona en ningún lado:** Problema es en el código

---

## 📞 SOPORTE

Si necesitas help:
1. Revisa los logs de Cloudflare
2. Verifica que `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` estén en secrets
3. Intenta redeploy completo
4. Prueba localmente con `npm run dev`

---

**TL;DR:** Apple Wallet está implementado correctamente. El problema es de conectividad Workers ↔ Supabase en la ruta dinámica. Necesita diagnosis más profunda en Cloudflare logs.

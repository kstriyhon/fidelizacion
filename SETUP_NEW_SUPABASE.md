# 🚀 Setup: Nuevo Proyecto Supabase

**Estado:** Las credenciales nuevas ya están en `.dev.vars`  
**Proyecto ID:** `zkecrbagxwewtubnusls`  
**URL:** `https://zkecrbagxwewtubnusls.supabase.co`

---

## ✅ Lo que ya está hecho

- ✅ `.dev.vars` actualizado con Service Role Key nueva
- ✅ Archivo `MIGRATION_COMBINED.sql` listo con ambas migraciones

## 📝 Paso 1: Ejecutar Migraciones en Supabase Dashboard

### Opción A: Ejecutar TODO junto (RECOMENDADO)

1. Ve a: https://app.supabase.com
2. Haz login con tu cuenta
3. Selecciona proyecto: **zkecrbagxwewtubnusls**
4. En el menú izquierdo → **SQL Editor**
5. Click **"+ New Query"**
6. Abre archivo: `MIGRATION_COMBINED.sql`
7. Copia TODO el contenido
8. Pégalo en Supabase SQL Editor
9. Click **"Run"** (botón azul arriba)

### Opción B: Ejecutar por partes (Si falla algo)

**Query 1:** Migración 0001 (tablas core)
- Archivo: `supabase/migrations/0001_loyalty_core.sql`

**Query 2:** Migración 0008 (Apple Wallet)
- Archivo: `supabase/migrations/0008_apple_wallet.sql`

---

## 🔧 Paso 2: Verificar Tablas

Una vez ejecutado, verifica que se crearon:

1. SQL Editor → Nueva Query
2. Pega esto:
   ```sql
   SELECT tablename FROM pg_tables 
   WHERE schemaname = 'public' 
   ORDER BY tablename;
   ```
3. Click "Run"

Deberías ver:
- ✅ loyalty_businesses
- ✅ loyalty_programs
- ✅ loyalty_members
- ✅ loyalty_stamp_events
- ✅ loyalty_apple_passes
- ✅ loyalty_device_registrations

---

## 🏗️ Paso 3: Configurar Cloudflare Workers

Una vez que las tablas estén creadas, configura Cloudflare con:

```bash
wrangler secret put SUPABASE_URL
# Pega: https://zkecrbagxwewtubnusls.supabase.co

wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# Pega: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprZWNyYmFneHdld3R1Ym51c2xzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzI3NTAyMCwiZXhwIjoyMTAyODUxMDIwfQ.WVqFNWJF9jTN-zOLtYrfvxd7usDD7P8q2QGDnKiZv-0
```

---

## 🧪 Paso 4: Testear Localmente

```bash
npm run dev
# Abre http://localhost:8080
```

Verifica:
- [ ] Página carga sin errores
- [ ] Ver `/unirse/[slug]` - botones Google + Apple
- [ ] Dashboard `/comercio` - badges de wallets

---

## 🚀 Paso 5: Deploy a Cloudflare

```bash
npm run build
npm run deploy
```

---

## 📋 Checklist Final

- [ ] Migraciones ejecutadas en Supabase
- [ ] 6 tablas creadas (verificadas con query)
- [ ] Secrets configurados en Cloudflare
- [ ] npm run build exitoso
- [ ] Local test exitoso
- [ ] Deploy a Cloudflare exitoso

---

## 🆘 Troubleshooting

### Error: "relation loyalty_members does not exist"
**Solución:** Las migraciones no se ejecutaron. Repite Paso 1.

### Error: "SUPABASE_SERVICE_ROLE_KEY" en Cloudflare
**Solución:** Ejecuta:
```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# Y pega la clave
```

### Error en SQL Editor
**Solución:** 
1. Divide el SQL en 2 queries (0001 y 0008)
2. Ejecuta 0001 primero
3. Luego ejecuta 0008

---

## 📚 Archivos Importantes

| Archivo | Descripción |
|---------|-------------|
| `.dev.vars` | Credenciales Supabase (actualizado) |
| `MIGRATION_COMBINED.sql` | SQL listo para copiar/pegar |
| `supabase/migrations/0001_loyalty_core.sql` | Tablas core |
| `supabase/migrations/0008_apple_wallet.sql` | Apple Wallet |

---

**Status:** ✅ Listo para ejecutar migraciones  
**Next:** Ve a Supabase Dashboard y ejecuta `MIGRATION_COMBINED.sql`

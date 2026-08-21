# Ejecutar Migración 0008: Apple Wallet

## 📋 Instrucciones

Como hemos hecho con las migraciones anteriores, esta debe correrse **manualmente** en el Supabase SQL Editor.

### Paso 1: Abre Supabase Dashboard

1. Ve a: https://app.supabase.com
2. Selecciona tu proyecto: `solasuxfnoipziijibam`
3. Click en **SQL Editor** (lado izquierdo)

### Paso 2: Copia el SQL

Abre el archivo: `supabase/migrations/0008_apple_wallet.sql`

Copia **TODO** el contenido del archivo.

### Paso 3: Pega en SQL Editor

1. En Supabase SQL Editor, haz click en **+ New Query**
2. Pega el SQL completo
3. Click en botón **Run** (esquina superior derecha)

### Paso 4: Verificar

Deberías ver:
```
✅ Query executed successfully (3 results)
```

Si hay error, revisa que:
- El SQL es válido
- Las tablas base existen (`loyalty_members`, etc.)
- No hay conflictos con otras migraciones

---

## ¿Qué crea esta migración?

**Nuevas tablas:**
- `loyalty_apple_passes` - Tracking de pases .pkpass
- `loyalty_device_registrations` - Dispositivos registrados para push APNs

**Nuevas columnas:**
- `loyalty_members.apple_pass_serial_number` - Serial del pase de Apple

**Índices:**
- Índices para performance en búsquedas frecuentes

**RLS:**
- Políticas de seguridad para service_role

---

## ¿Qué sigue?

Una vez ejecutada, notifica y continuamos con **Phase 3: Wallet Module** (crear `apple.server.ts`).

# Setup del Módulo de Gimnasio - Fideliza

## Estado: Código listo, Migraciones pendientes

El módulo de gimnasio está completamente implementado pero **necesitas ejecutar las migraciones SQL en Supabase** antes de probarlo.

## 📋 Pasos para activar el módulo

### 1. Abrir Supabase Dashboard

Ve a: **https://app.supabase.com** → Selecciona tu proyecto

### 2. Ejecutar las Migraciones

Haz clic en **SQL Editor** → **New query**

**Opción A: Ejecutar todo junto**

Copia y pega el SQL de abajo en el editor. Luego haz clic en **Run**.

**Opción B: Ejecutar por partes**

Ejecuta primero `0008_gym_module.sql` (tablas principales), luego `0009_gym_notifications.sql` (notificaciones).

---

## 🔧 SQL a Ejecutar

### Migración 1: Tablas principales del módulo de gimnasio

```sql
-- Módulo de Gimnasios para Fideliza
-- Añade capacidades de control de asistencia, membresías con vencimiento y sistema de referidos.
-- Las tablas utilizan prefijo gym_ para evitar conflictos con otras features futuras.

-- ---------------------------------------------------------------------------
-- Membresías de gimnasio (suscripción activa por miembro)
-- ---------------------------------------------------------------------------
create table if not exists public.gym_memberships (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.loyalty_members(id) on delete cascade,
  membership_type  text not null check (membership_type in ('monthly', 'quarterly', 'annual')),
  -- Fechas de la membresía
  started_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  -- Estado de pago
  payment_status   text not null default 'up_to_date' check (payment_status in ('up_to_date', 'overdue', 'paused')),
  -- Precio pagado (referencia)
  amount_paid      numeric(10, 2),
  -- Nota interna (motivo de pausa, etc)
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists gym_memberships_member_idx on public.gym_memberships(member_id);
create index if not exists gym_memberships_expires_at_idx on public.gym_memberships(expires_at);
create index if not exists gym_memberships_payment_status_idx on public.gym_memberships(payment_status);

-- ---------------------------------------------------------------------------
-- Historial de asistencias (check-in/out)
-- ---------------------------------------------------------------------------
create table if not exists public.gym_attendance (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.loyalty_members(id) on delete cascade,
  -- Timestamp de entrada o salida
  timestamp_at     timestamptz not null,
  -- Tipo de evento: 'check_in', 'check_out'
  event_type       text not null default 'check_in' check (event_type in ('check_in', 'check_out')),
  -- Duración de la sesión en minutos (se calcula si hay check-out anterior)
  duration_minutes int,
  -- Método de registro: 'qr', 'manual', 'auto' (automático si hay timeout)
  entry_method     text not null default 'manual' check (entry_method in ('qr', 'manual', 'auto')),
  created_at       timestamptz not null default now()
);
create index if not exists gym_attendance_member_idx on public.gym_attendance(member_id);
create index if not exists gym_attendance_timestamp_idx on public.gym_attendance(timestamp_at);
create index if not exists gym_attendance_member_date_idx on public.gym_attendance(member_id, date(timestamp_at));

-- ---------------------------------------------------------------------------
-- Sistema de referidos (recompensas por traer amigos)
-- ---------------------------------------------------------------------------
create table if not exists public.gym_referrals (
  id               uuid primary key default gen_random_uuid(),
  referrer_id      uuid not null references public.loyalty_members(id) on delete cascade,
  -- referree_id puede ser null si aún no se registra (referral code sin canjear)
  referree_id      uuid references public.loyalty_members(id) on delete cascade,
  -- Código único para compartir (ej. REF-ABC123DEF)
  referral_code    text not null unique,
  -- Tipo de recompensa: 'discount' (% descuento), 'stamps' (sellos extras), 'free_days'
  reward_type      text not null default 'discount' check (reward_type in ('discount', 'stamps', 'free_days')),
  -- Valor de la recompensa (ej. 10 = 10% si discount, 5 = 5 sellos, 7 = 7 días)
  reward_value     int not null,
  -- Estado del referido: 'pending' (no se registró), 'activated' (se registró), 'claimed' (recompensa entregada)
  status           text not null default 'pending' check (status in ('pending', 'activated', 'claimed')),
  -- Fecha en que se activó (referree completó registro)
  activated_at     timestamptz,
  -- Fecha en que se entregó la recompensa
  claimed_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists gym_referrals_referrer_idx on public.gym_referrals(referrer_id);
create index if not exists gym_referrals_referree_idx on public.gym_referrals(referree_id);
create index if not exists gym_referrals_code_idx on public.gym_referrals(referral_code);
create index if not exists gym_referrals_status_idx on public.gym_referrals(status);

-- ---------------------------------------------------------------------------
-- Configuración del programa (tipos de membresía y precios por gimnasio)
-- ---------------------------------------------------------------------------
create table if not exists public.gym_program_config (
  id               uuid primary key default gen_random_uuid(),
  program_id       uuid not null references public.loyalty_programs(id) on delete cascade,
  -- Duración en días de cada tipo de membresía
  monthly_days     int not null default 30 check (monthly_days between 15 and 45),
  quarterly_days   int not null default 90 check (quarterly_days between 60 and 120),
  annual_days      int not null default 365 check (annual_days between 330 and 400),
  -- Precios
  monthly_price    numeric(10, 2),
  quarterly_price  numeric(10, 2),
  annual_price     numeric(10, 2),
  -- Notificaciones de vencimiento (días antes de expirar para alertar)
  notify_days      int not null default 7 check (notify_days between 1 and 30),
  -- Habilitar automáticamente check-in por QR
  auto_checkin     boolean not null default false,
  -- Duración máxima de sesión antes de auto check-out (minutos, 0 = deshabilitado)
  auto_checkout_minutes int not null default 180 check (auto_checkout_minutes >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists gym_program_config_program_idx on public.gym_program_config(program_id);

-- ---------------------------------------------------------------------------
-- RLS (Row Level Security) — permisivo por ahora
-- ---------------------------------------------------------------------------
alter table public.gym_memberships enable row level security;
alter table public.gym_attendance enable row level security;
alter table public.gym_referrals enable row level security;
alter table public.gym_program_config enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'gym_memberships', 'gym_attendance', 'gym_referrals', 'gym_program_config'
  ] loop
    execute format('drop policy if exists "demo_all" on public.%I;', t);
    execute format(
      'create policy "demo_all" on public.%I for all to anon, authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;
```

### Migración 2: Sistema de Notificaciones

```sql
-- Módulo de notificaciones para vencimientos y recordatorios del gimnasio.
-- Tracks qué notificaciones se han enviado para evitar duplicados.

-- ---------------------------------------------------------------------------
-- Historial de notificaciones enviadas
-- ---------------------------------------------------------------------------
create table if not exists public.gym_notifications (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.loyalty_members(id) on delete cascade,
  membership_id    uuid references public.gym_memberships(id) on delete cascade,
  -- Tipo de notificación: 'expiration_reminder' (vencimiento próximo), 'welcome' (bienvenida)
  notification_type text not null check (notification_type in ('expiration_reminder', 'welcome', 'referral_activated', 'reward_claimed')),
  -- Canal: 'whatsapp', 'sms', 'email'
  channel          text not null default 'whatsapp' check (channel in ('whatsapp', 'sms', 'email')),
  -- Contenido del mensaje enviado
  message          text not null,
  -- Estado del envío: 'pending', 'sent', 'failed', 'bounced'
  status           text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'bounced')),
  -- Número de intentos
  retry_count      int not null default 0 check (retry_count >= 0),
  -- Respuesta o error del proveedor
  provider_response text,
  -- Metadatos: JSON con info adicional (código de notificación, etc)
  metadata         jsonb,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists gym_notifications_member_idx on public.gym_notifications(member_id);
create index if not exists gym_notifications_membership_idx on public.gym_notifications(membership_id);
create index if not exists gym_notifications_status_idx on public.gym_notifications(status);
create index if not exists gym_notifications_type_idx on public.gym_notifications(notification_type);
create index if not exists gym_notifications_created_idx on public.gym_notifications(created_at);

-- ---------------------------------------------------------------------------
-- Configuración de notificaciones por programa
-- ---------------------------------------------------------------------------
create table if not exists public.gym_notification_config (
  id               uuid primary key default gen_random_uuid(),
  program_id       uuid not null references public.loyalty_programs(id) on delete cascade unique,
  -- Habilitar notificaciones
  enabled          boolean not null default true,
  -- Canal preferido: whatsapp, sms, email
  preferred_channel text not null default 'whatsapp' check (preferred_channel in ('whatsapp', 'sms', 'email')),
  -- Alertar N días antes del vencimiento
  alert_days       int not null default 7 check (alert_days between 1 and 30),
  -- Mensaje personalizado (variables: {nombre}, {dias}, {fecha}, {negocio})
  reminder_message text,
  -- Habilitar mensaje de bienvenida
  send_welcome_msg boolean not null default true,
  -- Mensaje de bienvenida personalizado
  welcome_message  text,
  -- Horario en que enviar notificaciones (formato HH:MM UTC)
  notification_time text not null default '09:00',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists gym_notification_config_program_idx on public.gym_notification_config(program_id);

-- ---------------------------------------------------------------------------
-- RLS (permisiva)
-- ---------------------------------------------------------------------------
alter table public.gym_notifications enable row level security;
alter table public.gym_notification_config enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'gym_notifications', 'gym_notification_config'
  ] loop
    execute format('drop policy if exists "demo_all" on public.%I;', t);
    execute format(
      'create policy "demo_all" on public.%I for all to anon, authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;
```

---

## 📝 Después de ejecutar el SQL

Una vez hayas ejecutado ambas migraciones en Supabase, el módulo estará listo para usar.

### URLs disponibles:

| Ruta | Propósito |
|------|-----------|
| `/gym-inscribirse/:slug` | Inscripción pública para gimnasio |
| `/gym-referir/:code` | Inscripción con código de referido |
| `/gym/:memberId` | Dashboard del miembro |
| `/gym-admin/:programId` | Panel de administración del gimnasio |
| `/gym-notifications/:programId` | Configuración de notificaciones |

### Crear datos de prueba:

Para testear rápidamente, necesitas:
1. Un programa de tipo "Gimnasio" (puedes usar uno existente)
2. Miembros registrados
3. Membresías activas (se crean al inscribirse)

El código de la app crea automáticamente lo necesario cuando alguien se inscribe.

---

## ⚠️ Notas de seguridad

Las políticas RLS están en modo permisivo (`using (true)`) para la demo. **Antes de producción**, debes:
- Implementar autenticación con Supabase Auth
- Restringir acceso a datos sensibles (solo miembros ven su info)
- Validar que solo admins puedan ver el panel de administración

---

## 🆘 Troubleshooting

**Error: "Could not find the table 'public.gym_memberships'"**
→ Las migraciones no se han ejecutado. Copia y pega el SQL anterior en Supabase SQL Editor.

**Error: "Falta SUPABASE_SERVICE_ROLE_KEY"**
→ Verifica que `.dev.vars` esté en la raíz del proyecto y tenga la clave correcta.

**La app carga pero no muestra nada en las rutas `/gym-*`**
→ Probablemente no hay datos en la base de datos. Registra un miembro primero usando `/gym-inscribirse/:slug`.

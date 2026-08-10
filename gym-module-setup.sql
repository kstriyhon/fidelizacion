-- =============================================================================
-- MÓDULO DE GIMNASIO PARA FIDELIZA
-- =============================================================================
-- Ejecuta este script completo en Supabase Dashboard → SQL Editor → New query
-- Luego haz clic en "Run"
--
-- Incluye:
-- 1. Tablas principales del módulo (membresías, asistencia, referidos, config)
-- 2. Tablas de notificaciones (historial y configuración)
-- 3. Políticas RLS permisivas para demo
-- =============================================================================


-- =============================================================================
-- PARTE 1: TABLAS PRINCIPALES DEL MÓDULO
-- =============================================================================

-- Membresías de gimnasio (suscripción activa por miembro)
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

-- Historial de asistencias (check-in/out)
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
create index if not exists gym_attendance_member_timestamp_idx on public.gym_attendance(member_id, timestamp_at);

-- Sistema de referidos (recompensas por traer amigos)
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

-- Configuración del programa (tipos de membresía y precios por gimnasio)
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


-- =============================================================================
-- PARTE 2: TABLAS DE NOTIFICACIONES
-- =============================================================================

-- Historial de notificaciones enviadas
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

-- Configuración de notificaciones por programa
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


-- =============================================================================
-- PARTE 3: ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- Por ahora, todo es permisivo (como el resto del proyecto demo)
-- ⚠️ Antes de producción: restringir por usuario/miembro/programa

alter table public.gym_memberships enable row level security;
alter table public.gym_attendance enable row level security;
alter table public.gym_referrals enable row level security;
alter table public.gym_program_config enable row level security;
alter table public.gym_notifications enable row level security;
alter table public.gym_notification_config enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'gym_memberships', 'gym_attendance', 'gym_referrals', 'gym_program_config',
    'gym_notifications', 'gym_notification_config'
  ] loop
    execute format('drop policy if exists "demo_all" on public.%I;', t);
    execute format(
      'create policy "demo_all" on public.%I for all to anon, authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;

-- =============================================================================
-- ✅ SETUP COMPLETADO
-- =============================================================================
-- Las tablas e índices están listos.
-- El módulo de gimnasio ahora puede usar estas tablas.

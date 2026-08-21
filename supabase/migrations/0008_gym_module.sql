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
create index if not exists gym_attendance_member_date_idx on public.gym_attendance(member_id, ((timestamp_at at time zone 'utc')::date));

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
-- RLS (permisiva, como el resto del proyecto demo)
-- ---------------------------------------------------------------------------
alter table public.gym_memberships        enable row level security;
alter table public.gym_attendance         enable row level security;
alter table public.gym_referrals          enable row level security;
alter table public.gym_program_config     enable row level security;

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

-- ============================================================================
-- FIDELIZA: Migración completa para nuevo proyecto Supabase
-- Fecha: 2026-08-20
-- Instrucciones:
--   1. Ve a: https://app.supabase.com
--   2. Proyecto: zkecrbagxwewtubnusls
--   3. SQL Editor → New Query
--   4. Copia TODO este contenido (de aquí hasta el final)
--   5. Click "Run"
-- ============================================================================

-- Migration 0001: Núcleo de Fideliza (Loyalty Program)
-- ============================================================================

create table if not exists public.loyalty_businesses (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  logo_url     text,
  brand_color  text not null default '#4f46e5',
  contact_phone text,
  created_at   timestamptz not null default now()
);

create table if not exists public.loyalty_programs (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.loyalty_businesses(id) on delete cascade,
  name               text not null,
  stamps_required    int  not null default 10 check (stamps_required between 1 and 30),
  reward_description text not null default 'Un producto gratis',
  active             boolean not null default true,
  wallet_class_id    text,
  created_at         timestamptz not null default now()
);
create index if not exists loyalty_programs_business_idx on public.loyalty_programs(business_id);

create table if not exists public.loyalty_members (
  id               uuid primary key default gen_random_uuid(),
  program_id       uuid not null references public.loyalty_programs(id) on delete cascade,
  full_name        text not null,
  phone            text,
  email            text,
  stamps           int not null default 0 check (stamps >= 0),
  rewards_redeemed int not null default 0 check (rewards_redeemed >= 0),
  wallet_object_id text,
  enrolled_at      timestamptz not null default now(),
  last_stamp_at    timestamptz
);
create index if not exists loyalty_members_program_idx on public.loyalty_members(program_id);

create table if not exists public.loyalty_stamp_events (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.loyalty_members(id) on delete cascade,
  delta      int not null default 1,
  kind       text not null default 'stamp' check (kind in ('stamp','redeem','adjust')),
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_stamp_events_member_idx on public.loyalty_stamp_events(member_id);

-- RLS: permisiva para demo
alter table public.loyalty_businesses    enable row level security;
alter table public.loyalty_programs      enable row level security;
alter table public.loyalty_members       enable row level security;
alter table public.loyalty_stamp_events  enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'loyalty_businesses','loyalty_programs','loyalty_members','loyalty_stamp_events'
  ] loop
    execute format('drop policy if exists "demo_all" on public.%I;', t);
    execute format(
      'create policy "demo_all" on public.%I for all to anon, authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;

-- ============================================================================
-- Migration 0008: Apple Wallet (PassKit)
-- ============================================================================

-- Tabla: Apple Wallet passes
CREATE TABLE loyalty_apple_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  pass_type_id TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  auth_token TEXT NOT NULL,
  signature BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(member_id, pass_type_id)
);

CREATE INDEX idx_apple_passes_member ON loyalty_apple_passes(member_id);
CREATE INDEX idx_apple_passes_serial ON loyalty_apple_passes(pass_type_id, serial_number);

-- Tabla: Device registrations (APNs)
CREATE TABLE loyalty_device_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  device_library_identifier TEXT NOT NULL,
  push_token TEXT NOT NULL,
  registered_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(member_id, device_library_identifier)
);

CREATE INDEX idx_device_registrations_member ON loyalty_device_registrations(member_id);
CREATE INDEX idx_device_registrations_device ON loyalty_device_registrations(device_library_identifier);

-- Extender loyalty_members con Apple Wallet
ALTER TABLE loyalty_members
ADD COLUMN IF NOT EXISTS apple_pass_serial_number TEXT NULLABLE;

CREATE INDEX idx_members_apple_serial ON loyalty_members(apple_pass_serial_number)
WHERE apple_pass_serial_number IS NOT NULL;

-- RLS para Apple Wallet
ALTER TABLE loyalty_apple_passes ENABLE ROW LEVEL SECURITY;

CREATE POLICY apple_passes_select_service_role ON loyalty_apple_passes
  FOR SELECT USING (auth.uid() = auth.uid() OR current_user_id() = 'service_role');

CREATE POLICY apple_passes_insert_service_role ON loyalty_apple_passes
  FOR INSERT WITH CHECK (auth.uid() = auth.uid() OR current_user_id() = 'service_role');

CREATE POLICY apple_passes_update_service_role ON loyalty_apple_passes
  FOR UPDATE USING (auth.uid() = auth.uid() OR current_user_id() = 'service_role');

CREATE POLICY apple_passes_delete_service_role ON loyalty_apple_passes
  FOR DELETE USING (auth.uid() = auth.uid() OR current_user_id() = 'service_role');

ALTER TABLE loyalty_device_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY device_registrations_service_role ON loyalty_device_registrations
  FOR ALL USING (current_user_id() = 'service_role');

-- Comentarios
COMMENT ON TABLE loyalty_apple_passes IS
  'Pases .pkpass de Apple Wallet generados. Un pase por cliente.';

COMMENT ON TABLE loyalty_device_registrations IS
  'Dispositivos registrados en PassKit web service para recibir push APNs.';

COMMENT ON COLUMN loyalty_apple_passes.serial_number IS
  'UUID único del pase (usado en URLs de PassKit web service).';

COMMENT ON COLUMN loyalty_apple_passes.auth_token IS
  'Token de autenticación para validar requests del cliente al web service.';

COMMENT ON COLUMN loyalty_device_registrations.device_library_identifier IS
  'Identificador único del dispositivo, asignado por Apple.';

COMMENT ON COLUMN loyalty_device_registrations.push_token IS
  'Token de APNs para enviar notificaciones push al dispositivo.';

-- ============================================================================
-- FIN: Migración completada
-- ============================================================================

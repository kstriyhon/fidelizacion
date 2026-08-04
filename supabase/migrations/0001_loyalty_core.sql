-- Fideliza — Núcleo del producto de tarjetas de fidelización por sellos (Google Wallet).
-- Multi-tenant: varios comercios (restaurantes, panaderías, cafeterías...) cada uno
-- con su programa "N sellos = premio", sus clientes y el historial de sellos.
--
-- OJO: correr a mano en el SQL editor del dashboard de Supabase (no se aplica solo).
-- Las tablas van con prefijo loyalty_ porque hoy compartimos el mismo proyecto
-- Supabase que Unidental; a futuro conviene un proyecto Supabase propio.
--
-- RLS: por ahora políticas PERMISIVAS (rol anon puede todo) para poder demostrar
-- sin sistema de login. NO es seguro para producción real — endurecer luego con
-- auth por comercio. Ver comentarios "TODO seguridad".

-- ---------------------------------------------------------------------------
-- Comercios (tenants)
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_businesses (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,              -- para URLs públicas: /unirse/<slug>
  logo_url     text,
  brand_color  text not null default '#4f46e5',   -- color de la tarjeta en Wallet (hex)
  contact_phone text,                             -- WhatsApp del comercio (opcional)
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Programa de fidelización (config de sellos). 1 comercio -> N programas.
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_programs (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.loyalty_businesses(id) on delete cascade,
  name               text not null,                 -- ej. "Tarjeta de café"
  stamps_required    int  not null default 10 check (stamps_required between 1 and 30),
  reward_description text not null default 'Un producto gratis',
  active             boolean not null default true,
  -- Referencia a la LoyaltyClass creada en Google Wallet (issuerId.classSuffix).
  -- null hasta que se aprovisiona en Google (o en modo mock).
  wallet_class_id    text,
  created_at         timestamptz not null default now()
);
create index if not exists loyalty_programs_business_idx on public.loyalty_programs(business_id);

-- ---------------------------------------------------------------------------
-- Clientes finales inscritos a un programa.
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_members (
  id               uuid primary key default gen_random_uuid(),
  program_id       uuid not null references public.loyalty_programs(id) on delete cascade,
  full_name        text not null,
  phone            text,
  email            text,
  stamps           int not null default 0 check (stamps >= 0),
  rewards_redeemed int not null default 0 check (rewards_redeemed >= 0),
  -- Referencia al LoyaltyObject en Google Wallet (issuerId.objectSuffix).
  wallet_object_id text,
  enrolled_at      timestamptz not null default now(),
  last_stamp_at    timestamptz
);
create index if not exists loyalty_members_program_idx on public.loyalty_members(program_id);

-- ---------------------------------------------------------------------------
-- Historial de sellos (auditoría). delta normalmente +1; puede ser negativo
-- (corrección) o marcar un canje.
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_stamp_events (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.loyalty_members(id) on delete cascade,
  delta      int not null default 1,
  kind       text not null default 'stamp' check (kind in ('stamp','redeem','adjust')),
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_stamp_events_member_idx on public.loyalty_stamp_events(member_id);

-- ---------------------------------------------------------------------------
-- RLS permisiva (DEMO). TODO seguridad: reemplazar por auth real por comercio.
-- ---------------------------------------------------------------------------
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

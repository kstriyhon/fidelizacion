-- Sistema SAAS: Planes, suscripciones y facturación.

-- Tabla de planes disponibles
create table if not exists public.loyalty_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price_cop numeric not null,
  max_programs int not null,
  max_members int not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Tabla de suscripciones de negocios
create table if not exists public.loyalty_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.loyalty_businesses(id) on delete cascade,
  plan_id uuid not null references public.loyalty_plans(id),
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique(business_id)
);

-- Tabla de facturas
create table if not exists public.loyalty_invoices (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.loyalty_subscriptions(id) on delete cascade,
  business_id uuid not null references public.loyalty_businesses(id) on delete cascade,
  amount_cop numeric not null,
  month_year text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue', 'cancelled')),
  invoice_number text,
  due_date date,
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

-- Insertar planes por defecto
insert into public.loyalty_plans (name, price_cop, max_programs, max_members, description) values
  ('Profesional', 100000, 5, 500, 'Plan profesional para negocios pequeños'),
  ('Empresarial', 300000, 999, 999999, 'Plan empresarial sin límites')
on conflict (name) do nothing;

-- Índices
create index if not exists loyalty_subscriptions_business_idx on public.loyalty_subscriptions(business_id);
create index if not exists loyalty_subscriptions_plan_idx on public.loyalty_subscriptions(plan_id);
create index if not exists loyalty_invoices_subscription_idx on public.loyalty_invoices(subscription_id);
create index if not exists loyalty_invoices_business_idx on public.loyalty_invoices(business_id);
create index if not exists loyalty_invoices_status_idx on public.loyalty_invoices(status);

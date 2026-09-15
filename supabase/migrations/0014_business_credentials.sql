-- Tabla de credenciales de acceso por negocio
create table if not exists public.business_access_credentials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.loyalty_businesses(id) on delete cascade,
  username text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Índice para búsqueda rápida por username
create index if not exists business_access_credentials_username_idx on public.business_access_credentials(username);

-- Actualizar updated_at cuando se modifica el registro
create or replace function update_business_credentials_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger business_credentials_updated
before update on public.business_access_credentials
for each row
execute function update_business_credentials_timestamp();

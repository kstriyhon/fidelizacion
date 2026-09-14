-- Agregar credenciales de Google Wallet por programa.
-- Cada programa puede tener sus propias credenciales de administrador.
-- Si no las tiene, se usan las credenciales globales (variables de entorno).

alter table public.loyalty_programs add column if not exists
  google_wallet_issuer_id text;

alter table public.loyalty_programs add column if not exists
  google_wallet_sa_email text;

alter table public.loyalty_programs add column if not exists
  google_wallet_sa_private_key text;

-- Crear índice para búsquedas rápidas por issuer ID (useful para logs/debugging)
create index if not exists loyalty_programs_issuer_idx
  on public.loyalty_programs(google_wallet_issuer_id)
  where google_wallet_issuer_id is not null;

-- Agregar credenciales de acceso (usuario y contraseña) por programa.
-- Cada programa puede tener sus propias credenciales para acceder al panel.
-- Las credenciales de Google Wallet se manejan globalmente via variables de entorno.

alter table public.loyalty_programs add column if not exists
  access_username text;

alter table public.loyalty_programs add column if not exists
  access_password text;

-- Crear índice para búsquedas rápidas por username
create index if not exists loyalty_programs_username_idx
  on public.loyalty_programs(access_username)
  where access_username is not null;

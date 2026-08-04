-- Fase 1 de auth: liga cada comercio a su dueño (usuario de Supabase Auth).
-- Correr a mano en el SQL editor del dashboard.
--
-- NOTA: por ahora la RLS sigue en modo demo permisivo (ver 0001). La protección
-- real por dueño a nivel de base de datos es la FASE 2 (endurecer RLS + usar
-- service-role en las server functions). Aquí solo agregamos la columna y el
-- filtrado por dueño se hace en la app.

alter table public.loyalty_businesses
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

create index if not exists loyalty_businesses_owner_idx
  on public.loyalty_businesses(owner_id);

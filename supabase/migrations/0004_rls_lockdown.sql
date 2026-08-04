-- Fase 2: endurecer RLS. Correr a mano en el SQL editor.
--
-- Modelo:
--  - Con la ANON key (pública, en el navegador) solo se puede LEER negocios y
--    programas (necesario para la página pública de inscripción /unirse/:slug).
--  - La tabla de clientes (members) y el historial (stamp_events) quedan CERRADOS
--    a anon/authenticated: solo el servidor (service_role) los toca, con
--    autorización explícita (dueño o admin) en las server functions.
--  - Toda ESCRITURA (crear negocio, inscribir, sellar, mensajes) va por el servidor
--    con service_role, que OMITE la RLS. Por eso aquí no damos permisos de escritura
--    a anon/authenticated.
--
-- IMPORTANTE: aplicar DESPUÉS de desplegar el código nuevo (que lee/escribe vía
-- server functions con service_role). Si se aplica antes, el panel no podrá leer
-- clientes con la anon key.

-- Quitar las políticas permisivas de demo (0001)
drop policy if exists "demo_all" on public.loyalty_businesses;
drop policy if exists "demo_all" on public.loyalty_programs;
drop policy if exists "demo_all" on public.loyalty_members;
drop policy if exists "demo_all" on public.loyalty_stamp_events;

-- Asegurar RLS activa
alter table public.loyalty_businesses    enable row level security;
alter table public.loyalty_programs      enable row level security;
alter table public.loyalty_members       enable row level security;
alter table public.loyalty_stamp_events  enable row level security;

-- Lectura pública SOLO de negocios y programas (para /unirse). Sin escritura.
create policy "public_read_businesses" on public.loyalty_businesses
  for select to anon, authenticated using (true);

create policy "public_read_programs" on public.loyalty_programs
  for select to anon, authenticated using (true);

-- members y stamp_events: SIN políticas => nadie con anon/authenticated puede
-- leer ni escribir. Solo service_role (que omite RLS) desde el servidor.
--
-- Nota: service_role NO se ve afectado por estas políticas (las bypassa), así que
-- el backend sigue pudiendo hacer todo con autorización propia.

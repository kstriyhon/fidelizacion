-- Mensaje personalizable que recibe el cliente al darle un sello.
-- Correr a mano en el SQL editor. Si es null, la app usa un mensaje por defecto.
-- Soporta variables: {sellos} {total} {faltan} {negocio} {premio} {nombre}

alter table public.loyalty_programs
  add column if not exists stamp_message text;

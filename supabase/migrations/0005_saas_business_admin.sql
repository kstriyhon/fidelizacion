-- Módulo de administración empresarial (SaaS): datos de gestión de cada empresa.
-- Correr a mano en el SQL editor.
--
-- - email: correo de contacto de la empresa.
-- - status: estado del SERVICIO. 'active' = operativo; 'paused' = pausado (por ej.
--   por falta de pago). Cuando está pausado, se bloquean inscripciones y sellos.
-- - payment_status: estado de PAGOS que lleva el admin manualmente.
--   'up_to_date' = al día; 'overdue' = atrasado.
-- (nombre, contact_phone y created_at -- fecha de inicio -- ya existen en la tabla.)

alter table public.loyalty_businesses
  add column if not exists email text,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'paused')),
  add column if not exists payment_status text not null default 'up_to_date'
    check (payment_status in ('up_to_date', 'overdue'));

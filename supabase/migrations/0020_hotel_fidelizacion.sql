-- Fidelización post-estancia del hotel.
--
-- Hasta ahora la tarjeta del huésped caducaba en el check-out y ahí se acababa
-- la relación. Con esto, al terminar la estancia la MISMA tarjeta se convierte
-- en tarjeta de fidelización: deja de caducar y pasa a mostrar el nivel del
-- huésped y lo que ese nivel le da. Cuando reserve otra vez, vuelve a mostrar
-- la estancia.
--
-- Por qué no se crea una segunda tarjeta: se decidió "una tarjeta por huésped"
-- justamente para que al volver no compitan dos. Una tarjeta de estancia y otra
-- de fidelización serían ese mismo problema con otro nombre.
--
-- Por qué no hay tabla de puntos ni contadores: las estancias y las noches se
-- calculan sumando hotel_reservations. Un contador guardado es un dato que se
-- puede desincronizar de los hechos —basta cancelar una reserva o corregir una
-- fecha— y entonces el huésped ve un nivel que no le corresponde.

-- ---------------------------------------------------------------------------
-- Niveles del hotel
-- ---------------------------------------------------------------------------
-- Cada hotel pone los suyos. Forma:
--   [{ "nombre": "Plata", "estancias": 3, "beneficio": "10% en el restaurante" }, …]
--
-- "estancias" es el MÍNIMO de estancias terminadas para estar en ese nivel. El
-- huésped está en el nivel más alto cuyo mínimo alcanza.
--
-- Se guarda como jsonb y no en una tabla aparte por lo mismo que services y
-- guest_guide: son cuatro filas que cambian cuando el hotel cambia de política,
-- no entidades con vida propia.

alter table public.hotel_settings
  add column if not exists loyalty_levels jsonb not null default '[]'::jsonb;

comment on column public.hotel_settings.loyalty_levels is
  'Niveles de fidelización del hotel. [] = desactivada: la tarjeta caduca al salir, como antes.';

-- ---------------------------------------------------------------------------
-- Índice para contar estancias
-- ---------------------------------------------------------------------------
-- El nivel se calcula en cada actualización del pase, así que esta cuenta se
-- hace a menudo: por huésped, cuántas reservas suyas están terminadas.

create index if not exists hotel_reservations_member_status_idx
  on public.hotel_reservations (member_id, status);

-- Comprobación tras aplicarla:
--   select loyalty_levels from hotel_settings;        -> debe dar []
--   los pases existentes siguen igual hasta que el hotel defina niveles.

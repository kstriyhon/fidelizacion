-- Primer paso hacia la plataforma multi-vertical: el sistema deja de asumir que
-- todo programa es "sellos y premios", y se añade lo que necesita la vertical
-- de hotel (reservas de un cliente real que está esperando).
--
-- NADA cambia para los comercios actuales: los tres quedan marcados como
-- 'fidelizacion' por defecto y su comportamiento es idéntico.
--
-- Sobre los nombres: las tablas siguen llamándose loyalty_* aunque ya no sean
-- solo de fidelización. Renombrarlas en una base con clientes reales y pases ya
-- emitidos es un riesgo que no compensa por estética.

-- ---------------------------------------------------------------------------
-- 1. Vertical del negocio y tipo de programa
-- ---------------------------------------------------------------------------

alter table public.loyalty_businesses
  add column if not exists vertical text not null default 'fidelizacion'
    check (vertical in ('fidelizacion', 'hotel'));

alter table public.loyalty_programs
  add column if not exists tipo text not null default 'sellos'
    check (tipo in ('sellos', 'hotel'));

comment on column public.loyalty_businesses.vertical is
  'Sector del negocio. Decide qué módulos del panel se muestran.';
comment on column public.loyalty_programs.tipo is
  'Qué clase de pase emite este programa. El Wallet Engine se ramifica por aquí.';

-- ---------------------------------------------------------------------------
-- 2. Documento de identidad del cliente (cédula)
-- ---------------------------------------------------------------------------
-- Es con lo que se reconoce al huésped que vuelve, para actualizar SU tarjeta
-- en vez de emitirle una segunda.
--
-- ⚠️ DATO SENSIBLE. En Colombia la cédula está cubierta por la ley de Habeas
-- Data y es un identificador fuerte: una filtración afecta a la persona, no
-- solo al negocio. Por eso:
--   - no se incluye en MEMBER_CLIENT_COLUMNS (no sale al navegador por defecto);
--   - no va NUNCA dentro del pase de Wallet, ni en el QR ni en los textos;
--   - abajo se revoca su lectura a las claves públicas.

alter table public.loyalty_members
  add column if not exists document_id text;

comment on column public.loyalty_members.document_id is
  'Cédula u otro documento. SENSIBLE: no exponer al cliente ni meter en el pase.';

-- Único POR PROGRAMA, no globalmente: el huésped dio su cédula a ESE hotel, no
-- a la plataforma para compartirla entre negocios. Si mañana hay dos hoteles,
-- la misma persona son dos registros independientes, que es lo correcto.
-- El índice es parcial para no estorbar a los programas de sellos, donde el
-- documento no se pide y queda a null.
create unique index if not exists loyalty_members_programa_documento_key
  on public.loyalty_members (program_id, document_id)
  where document_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Reservas de hotel
-- ---------------------------------------------------------------------------
-- Un huésped (loyalty_members) tiene muchas reservas a lo largo del tiempo. El
-- pase muestra la vigente; al volver, se crea otra reserva y se ACTUALIZA el
-- mismo pase — nunca se emite uno nuevo.

create table if not exists public.hotel_reservations (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.loyalty_members(id) on delete cascade,

  reservation_code text not null,
  room            text,
  room_type       text,
  guests          int not null default 1 check (guests > 0),

  check_in        timestamptz not null,
  check_out       timestamptz not null,

  -- 'confirmada' antes de llegar, 'en_curso' tras el check-in, 'finalizada' al
  -- salir, 'cancelada' si no llegó a usarse.
  status          text not null default 'confirmada'
    check (status in ('confirmada', 'en_curso', 'finalizada', 'cancelada')),

  -- Enlace que el hotel envía al huésped para que cree su tarjeta.
  --
  -- Es un token aleatorio y NO el código de reserva: la página que abre muestra
  -- nombre, habitación y fechas de esa persona. Si el enlace llevara el código
  -- —que los hoteles suelen numerar de forma correlativa— cualquiera podría
  -- recorrerlos y leer las reservas de los demás huéspedes.
  access_token    text not null default encode(gen_random_bytes(16), 'hex'),

  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- El check-out no puede ser anterior al check-in: la fecha de salida es la
  -- que caduca el pase, así que una inversión dejaría la tarjeta muerta al nacer.
  constraint hotel_reservations_fechas_coherentes check (check_out > check_in)
);

create index if not exists hotel_reservations_member_idx
  on public.hotel_reservations (member_id, check_in desc);

-- Dentro de un hotel el código de reserva no se repite. Se resuelve por el
-- programa del huésped, que es lo que delimita el hotel.
create unique index if not exists hotel_reservations_codigo_key
  on public.hotel_reservations (member_id, reservation_code);

-- Por aquí entra el huésped desde el enlace que le manda el hotel.
create unique index if not exists hotel_reservations_access_token_key
  on public.hotel_reservations (access_token);

alter table public.hotel_reservations enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Datos del hotel para el pase (servicios, horarios, contactos)
-- ---------------------------------------------------------------------------
-- Lo que el huésped ve en su tarjeta y rara vez cambia. Se guarda como JSON
-- porque cada hotel tiene su propia lista de servicios y horarios: forzar
-- columnas fijas obligaría a una migración cada vez que uno pida algo distinto.

create table if not exists public.hotel_settings (
  business_id     uuid primary key references public.loyalty_businesses(id) on delete cascade,

  -- [{ "titulo": "Restaurante", "url": "https://…" }, …]
  -- Ojo: Wallet muestra como máximo 10 enlaces del objeto. Por encima de eso,
  -- conviene un enlace a una página web con el resto.
  services        jsonb not null default '[]'::jsonb,

  -- [{ "titulo": "Desayuno", "valor": "6:30 a 10:00" }, …]
  guest_guide     jsonb not null default '[]'::jsonb,

  reception_phone text,
  whatsapp        text,
  website         text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.hotel_settings enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Proteger la cédula de las claves públicas
-- ---------------------------------------------------------------------------
-- Mismo patrón que la 0017: un REVOKE por columnas NO recorta el GRANT de tabla
-- que Supabase da a anon, así que hay que quitar el de tabla y volver a conceder
-- solo lo que puede salir. Si no se hace así, la migración no surte efecto.
--
-- La lista debe seguir a MEMBER_CLIENT_COLUMNS en src/lib/data.ts.

revoke select on public.loyalty_members from anon, authenticated;

grant select (
  id,
  program_id,
  full_name,
  phone,
  email,
  stamps,
  rewards_redeemed,
  wallet_object_id,
  apple_pass_serial_number,
  enrolled_at,
  last_stamp_at,
  created_at,
  updated_at,
  birth_month,
  birth_day
) on public.loyalty_members to anon, authenticated;

-- Comprobación tras aplicarla:
--   ?select=document_id  con la anon key  -> debe dar "permission denied"
--   ?select=full_name    con la anon key  -> debe seguir funcionando

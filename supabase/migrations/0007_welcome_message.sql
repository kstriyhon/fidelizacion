-- Mensaje de bienvenida que recibe el cliente al inscribirse (aparece en su
-- tarjeta de Google Wallet). Correr a mano en el SQL editor.
-- Si es null, se usa un mensaje por defecto. Soporta {nombre} y {negocio}.

alter table public.loyalty_programs
  add column if not exists welcome_message text;

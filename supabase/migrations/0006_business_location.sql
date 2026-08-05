-- Ubicación del negocio para alertas de proximidad de Google Wallet.
-- Correr a mano en el SQL editor.
--
-- Google Wallet muestra la tarjeta / una notificación cuando el cliente está
-- cerca de estas coordenadas. El RADIO lo decide Google (~150 m); no es
-- configurable por el emisor. null = sin alerta de proximidad.

alter table public.loyalty_businesses
  add column if not exists latitude  double precision,
  add column if not exists longitude double precision;

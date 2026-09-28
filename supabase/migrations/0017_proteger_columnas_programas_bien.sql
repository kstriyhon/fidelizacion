-- CORRIGE la 0016, que no surtió efecto.
--
-- Por qué falló: la 0016 hacía REVOKE SELECT (columnas). En Postgres eso NO
-- recorta un permiso concedido a nivel de TABLA — y Supabase le concede a anon
-- y authenticated un GRANT SELECT sobre la tabla completa. Mientras ese permiso
-- de tabla exista, todas las columnas siguen siendo legibles y el revoke por
-- columnas es inocuo. (Comprobado: tras aplicar la 0016, la anon key seguía
-- devolviendo google_wallet_sa_private_key sin error.)
--
-- La forma correcta es al revés: quitar el permiso de tabla y volver a conceder
-- SOLO la lista de columnas que pueden salir al navegador.
--
-- Debe coincidir con PROGRAM_CLIENT_COLUMNS en src/lib/data.ts. Si añades una
-- columna nueva que el cliente necesite, hay que añadirla en los dos sitios.

revoke select on public.loyalty_programs from anon, authenticated;

grant select (
  id,
  business_id,
  name,
  stamps_required,
  reward_description,
  active,
  wallet_class_id,
  stamp_message,
  welcome_message,
  created_at,
  updated_at
) on public.loyalty_programs to anon, authenticated;

-- service_role no se toca: el servidor necesita las credenciales de Wallet para
-- firmar los pases, y además omite RLS y permisos por diseño.

-- Comprobación tras aplicarla:
--   Debe FALLAR con "permission denied for column":
--     ?select=google_wallet_sa_private_key
--   Debe SEGUIR FUNCIONANDO (si no, /unirse/{slug} se rompe):
--     ?select=name,stamps_required,active

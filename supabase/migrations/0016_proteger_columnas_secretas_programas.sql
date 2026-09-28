-- Quita a las claves PÚBLICAS el permiso de leer las columnas sensibles de
-- loyalty_programs.
--
-- Por qué hace falta además del arreglo en la app: la RLS filtra FILAS, no
-- columnas. Como /unirse/{slug} es público, la tabla tiene que ser legible con
-- la anon key — y esa key viaja en el bundle del navegador, así que cualquiera
-- puede consultar la API REST directamente. Sin esto, bastaba con pedir
-- ?select=google_wallet_sa_private_key para leer la clave privada de Wallet de
-- cualquier programa.
--
-- Hoy esas columnas están todas a null, así que no se filtró nada. Esto evita
-- que se filtren el día que se configuren desde el panel.
--
-- service_role NO se toca: el servidor sigue necesitando leerlas para firmar
-- los pases de Google Wallet.
--
-- ⚠️ ORDEN DE APLICACIÓN: despliega primero el código que deja de pedir "*"
-- sobre loyalty_programs (commit que acompaña a esta migración). Si se corre
-- esto con la versión anterior en producción, /unirse/{slug} y /p/{slug}
-- empezarían a fallar con "permission denied for column".

revoke select (
  google_wallet_issuer_id,
  google_wallet_sa_email,
  google_wallet_sa_private_key,
  access_username,
  access_password
) on public.loyalty_programs from anon, authenticated;

-- Comprobación sugerida tras aplicarla (debe dar "permission denied"):
--   curl "$URL/rest/v1/loyalty_programs?select=google_wallet_sa_private_key" \
--     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"

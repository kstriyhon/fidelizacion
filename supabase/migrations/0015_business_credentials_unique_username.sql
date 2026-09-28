-- El username es con lo que se inicia sesión en /p/{slug}, así que tiene que ser
-- único. La 0014 solo creó un índice normal, de modo que nada impedía dar de alta
-- dos negocios con el mismo usuario; al hacerlo, la consulta de login devuelve
-- dos filas y revienta para AMBOS negocios.
--
-- El índice es sobre la columna tal cual (no sobre lower(username)) a propósito:
-- el login compara con igualdad exacta, y un índice case-insensitive aquí diría
-- que un usuario "ya existe" mientras que escribirlo con otra caja no entraría.
--
-- Si esto falla por duplicados ya existentes, localízalos y renómbralos antes:
--   select username, count(*) from public.business_access_credentials
--   group by username having count(*) > 1;

drop index if exists business_access_credentials_username_idx;

create unique index if not exists business_access_credentials_username_key
  on public.business_access_credentials (username);

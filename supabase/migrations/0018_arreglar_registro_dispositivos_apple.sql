-- Arregla el registro de dispositivos de Apple Wallet, que estaba ROTO: ningún
-- iPhone conseguía registrarse, así que no teníamos ningún push_token y las
-- notificaciones de Apple nunca salían.
--
-- Qué pasaba: loyalty_device_registrations en este proyecto quedó incompleta
-- (la 0008_apple_wallet nunca se aplicó entera al migrar de proyecto Supabase).
-- Tenía id, member_id, push_token, created_at y updated_at, pero le faltaban
-- device_library_identifier y registered_at, que es lo que escribe el handler
-- de passkit.server.ts. El upsert fallaba, el endpoint devolvía 500 y Wallet
-- se rendía en silencio.
--
-- Comprobado antes de escribir esto: POST al endpoint de registro con el
-- authenticationToken del propio pase devolvía
--   500 {"error":"Failed to register device"}
-- y la tabla tenía 0 filas pese a haber 5 pases emitidos.
--
-- La tabla está vacía, así que añadir NOT NULL no rompe nada.

alter table public.loyalty_device_registrations
  add column if not exists device_library_identifier text,
  add column if not exists registered_at timestamptz default now();

-- El identificador de dispositivo es obligatorio: sin él no se puede saber a
-- qué aparato pertenece el token.
update public.loyalty_device_registrations
  set device_library_identifier = coalesce(device_library_identifier, id::text)
  where device_library_identifier is null;

alter table public.loyalty_device_registrations
  alter column device_library_identifier set not null;

-- El handler hace upsert con onConflict "member_id,device_library_identifier",
-- así que esa pareja TIENE que ser única o el upsert no sabe sobre qué resolver.
create unique index if not exists loyalty_device_registrations_member_device_key
  on public.loyalty_device_registrations (member_id, device_library_identifier);

-- Comprobación tras aplicarla: volver a lanzar el registro con el token de un
-- pase real debe devolver 201 en vez de 500, y dejar una fila en la tabla.

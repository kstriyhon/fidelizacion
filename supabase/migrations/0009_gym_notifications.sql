-- Módulo de notificaciones para vencimientos y recordatorios del gimnasio.
-- Tracks qué notificaciones se han enviado para evitar duplicados.

-- ---------------------------------------------------------------------------
-- Historial de notificaciones enviadas
-- ---------------------------------------------------------------------------
create table if not exists public.gym_notifications (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.loyalty_members(id) on delete cascade,
  membership_id    uuid references public.gym_memberships(id) on delete cascade,
  -- Tipo de notificación: 'expiration_reminder' (vencimiento próximo), 'welcome' (bienvenida)
  notification_type text not null check (notification_type in ('expiration_reminder', 'welcome', 'referral_activated', 'reward_claimed')),
  -- Canal: 'whatsapp', 'sms', 'email'
  channel          text not null default 'whatsapp' check (channel in ('whatsapp', 'sms', 'email')),
  -- Contenido del mensaje enviado
  message          text not null,
  -- Estado del envío: 'pending', 'sent', 'failed', 'bounced'
  status           text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'bounced')),
  -- Número de intentos
  retry_count      int not null default 0 check (retry_count >= 0),
  -- Respuesta o error del proveedor
  provider_response text,
  -- Metadatos: JSON con info adicional (código de notificación, etc)
  metadata         jsonb,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists gym_notifications_member_idx on public.gym_notifications(member_id);
create index if not exists gym_notifications_membership_idx on public.gym_notifications(membership_id);
create index if not exists gym_notifications_status_idx on public.gym_notifications(status);
create index if not exists gym_notifications_type_idx on public.gym_notifications(notification_type);
create index if not exists gym_notifications_created_idx on public.gym_notifications(created_at);

-- ---------------------------------------------------------------------------
-- Configuración de notificaciones por programa
-- ---------------------------------------------------------------------------
create table if not exists public.gym_notification_config (
  id               uuid primary key default gen_random_uuid(),
  program_id       uuid not null references public.loyalty_programs(id) on delete cascade unique,
  -- Habilitar notificaciones
  enabled          boolean not null default true,
  -- Canal preferido: whatsapp, sms, email
  preferred_channel text not null default 'whatsapp' check (preferred_channel in ('whatsapp', 'sms', 'email')),
  -- Alertar N días antes del vencimiento
  alert_days       int not null default 7 check (alert_days between 1 and 30),
  -- Mensaje personalizado (variables: {nombre}, {dias}, {fecha}, {negocio})
  reminder_message text,
  -- Habilitar mensaje de bienvenida
  send_welcome_msg boolean not null default true,
  -- Mensaje de bienvenida personalizado
  welcome_message  text,
  -- Horario en que enviar notificaciones (formato HH:MM UTC)
  notification_time text not null default '09:00',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists gym_notification_config_program_idx on public.gym_notification_config(program_id);

-- ---------------------------------------------------------------------------
-- RLS (permisiva)
-- ---------------------------------------------------------------------------
alter table public.gym_notifications enable row level security;
alter table public.gym_notification_config enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'gym_notifications', 'gym_notification_config'
  ] loop
    execute format('drop policy if exists "demo_all" on public.%I;', t);
    execute format(
      'create policy "demo_all" on public.%I for all to anon, authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;

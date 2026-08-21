-- Migration: 0008_apple_wallet.sql
-- Descripción: Tablas y columnas para soporte de Apple Wallet (PassKit)
-- Fecha: 2026-08-19
-- Autor: Claude Code

-- ============================================================================
-- 1. Tabla: loyalty_apple_passes
-- Descripción: Tracking de pases .pkpass generados y sus firmas
-- ============================================================================

CREATE TABLE loyalty_apple_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK a cliente que posee el pase
  member_id UUID NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,

  -- Identificadores de Apple Wallet
  pass_type_id TEXT NOT NULL,  -- Ej: pass.loyalty.fideliza
  serial_number TEXT NOT NULL,  -- UUID único del pase (generado por nosotros)

  -- Token para autenticar requests del cliente (PassKit web service)
  auth_token TEXT NOT NULL,

  -- Firma PKCS#7 del pase (cacheada para re-envíos sin regenerar)
  signature BYTEA NOT NULL,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Un pase por cliente por Pass Type ID
  UNIQUE(member_id, pass_type_id)
);

CREATE INDEX idx_apple_passes_member ON loyalty_apple_passes(member_id);
CREATE INDEX idx_apple_passes_serial ON loyalty_apple_passes(pass_type_id, serial_number);

-- ============================================================================
-- 2. Tabla: loyalty_device_registrations
-- Descripción: Dispositivos registrados en nuestro PassKit web service
--              para recibir push notifications via APNs
-- ============================================================================

CREATE TABLE loyalty_device_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK a cliente
  member_id UUID NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,

  -- Identificador único del dispositivo (asignado por Apple)
  device_library_identifier TEXT NOT NULL,

  -- Token de push de APNs (usado para enviar notificaciones)
  push_token TEXT NOT NULL,

  -- Metadata
  registered_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Un dispositivo por cliente
  UNIQUE(member_id, device_library_identifier)
);

CREATE INDEX idx_device_registrations_member ON loyalty_device_registrations(member_id);
CREATE INDEX idx_device_registrations_device ON loyalty_device_registrations(device_library_identifier);

-- ============================================================================
-- 3. Extender loyalty_members con Apple Wallet tracking
-- ============================================================================

ALTER TABLE loyalty_members
ADD COLUMN IF NOT EXISTS apple_pass_serial_number TEXT NULLABLE;

CREATE INDEX idx_members_apple_serial ON loyalty_members(apple_pass_serial_number)
WHERE apple_pass_serial_number IS NOT NULL;

-- ============================================================================
-- 4. RLS (Row Level Security)
-- ============================================================================

-- loyalty_apple_passes: service_role puede todo; anon/authenticated solo leen lo suyo
ALTER TABLE loyalty_apple_passes ENABLE ROW LEVEL SECURITY;

CREATE POLICY apple_passes_select_service_role ON loyalty_apple_passes
  FOR SELECT USING (auth.uid() = auth.uid() OR current_user_id() = 'service_role');

CREATE POLICY apple_passes_insert_service_role ON loyalty_apple_passes
  FOR INSERT WITH CHECK (auth.uid() = auth.uid() OR current_user_id() = 'service_role');

CREATE POLICY apple_passes_update_service_role ON loyalty_apple_passes
  FOR UPDATE USING (auth.uid() = auth.uid() OR current_user_id() = 'service_role');

CREATE POLICY apple_passes_delete_service_role ON loyalty_apple_passes
  FOR DELETE USING (auth.uid() = auth.uid() OR current_user_id() = 'service_role');

-- loyalty_device_registrations: service_role puede todo; anon/authenticated cerrados
ALTER TABLE loyalty_device_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY device_registrations_service_role ON loyalty_device_registrations
  FOR ALL USING (current_user_id() = 'service_role');

-- ============================================================================
-- 5. Comentarios
-- ============================================================================

COMMENT ON TABLE loyalty_apple_passes IS
  'Pases .pkpass de Apple Wallet generados. Un pase por cliente.';

COMMENT ON TABLE loyalty_device_registrations IS
  'Dispositivos registrados en PassKit web service para recibir push APNs.';

COMMENT ON COLUMN loyalty_apple_passes.serial_number IS
  'UUID único del pase (usado en URLs de PassKit web service).';

COMMENT ON COLUMN loyalty_apple_passes.auth_token IS
  'Token de autenticación para validar requests del cliente al web service.';

COMMENT ON COLUMN loyalty_device_registrations.device_library_identifier IS
  'Identificador único del dispositivo, asignado por Apple.';

COMMENT ON COLUMN loyalty_device_registrations.push_token IS
  'Token de APNs para enviar notificaciones push al dispositivo.';

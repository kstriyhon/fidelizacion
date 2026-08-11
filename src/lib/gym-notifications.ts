// Sistema de notificaciones para vencimientos y recordatorios del gimnasio.
//
// Igual que gymActions.ts: las server functions usan el builder de TanStack Start
// (`createServerFn({method}).validator(schema).handler(async ({data}) => …)`) y se
// invocan como `fn({ data: {…} })`. La lógica vive en helpers planos para que
// `triggerExpirationNotificationsFn` los llame directo, sin pasar por RPC.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "./supabaseAdmin.server";
import { requireProgramAccess, requireMemberAccess } from "./authz.server";
import type { Membership } from "./gym-data";
import type { Member } from "./data";

// Todas las server functions de este archivo son administrativas: exigen `token`
// y que quien llama sea DUEÑO del negocio o ADMIN. Usan service_role (se salta
// la RLS), así que la autorización tiene que ser explícita en cada una.

const DAY = 24 * 60 * 60 * 1000; // milisegundos

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type NotificationType =
  | "expiration_reminder"
  | "welcome"
  | "referral_activated"
  | "reward_claimed";
export type NotificationChannel = "whatsapp" | "sms" | "email";
export type NotificationStatus = "pending" | "sent" | "failed" | "bounced";

export type GymNotification = {
  id: string;
  member_id: string;
  membership_id: string | null;
  notification_type: NotificationType;
  channel: NotificationChannel;
  message: string;
  status: NotificationStatus;
  retry_count: number;
  provider_response: string | null;
  // jsonb en Postgres: contenido libre (hoy guardamos `whatsapp_url`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any> | null;
  created_at: string;
  sent_at: string | null;
  updated_at: string;
  // Presente cuando la consulta incluye el embed del miembro.
  loyalty_members?: { id: string; full_name: string; phone: string | null } | null;
};

export type NotificationConfig = {
  id: string;
  program_id: string;
  enabled: boolean;
  preferred_channel: NotificationChannel;
  alert_days: number;
  reminder_message: string | null;
  send_welcome_msg: boolean;
  welcome_message: string | null;
  notification_time: string;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Utilidades puras (también se usan desde el cliente)
// ---------------------------------------------------------------------------

/** Interpola variables {clave} en una plantilla. */
export function interpolateMessage(
  template: string,
  variables: Record<string, string | number>,
): string {
  let message = template;
  for (const [key, value] of Object.entries(variables)) {
    message = message.replace(new RegExp(`{${key}}`, "g"), String(value));
  }
  return message;
}

/** URL de WhatsApp (wa.me) con el teléfono saneado. */
export function getWhatsAppUrl(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(message)}`;
}

export const DEFAULT_EXPIRATION_TEMPLATE =
  "Hola {nombre}, tu membresía en {negocio} vence en {dias} días ({fecha}). Renuévala ahora para no perder acceso 💪";

export const DEFAULT_WELCOME_TEMPLATE =
  "¡Bienvenido {nombre} a {negocio}! 🏋️ Tu membresía está activa. Accede a tu dashboard para ver tu código de referido y compartir con amigos 💪";

/** Mensaje de vencimiento (usa la plantilla del programa si la hay). */
export function getExpirationMessage(
  memberName: string,
  daysLeft: number,
  expirationDate: Date,
  businessName: string,
  customTemplate?: string,
): string {
  return interpolateMessage(customTemplate || DEFAULT_EXPIRATION_TEMPLATE, {
    nombre: memberName,
    dias: daysLeft,
    fecha: expirationDate.toLocaleDateString("es-ES"),
    negocio: businessName,
  });
}

/** Mensaje de bienvenida (usa la plantilla del programa si la hay). */
export function getWelcomeMessage(
  memberName: string,
  businessName: string,
  customTemplate?: string,
): string {
  return interpolateMessage(customTemplate || DEFAULT_WELCOME_TEMPLATE, {
    nombre: memberName.split(" ")[0], // solo el nombre de pila
    negocio: businessName,
  });
}

// ---------------------------------------------------------------------------
// Helpers de servidor (lógica compartida, sin pasar por RPC)
// ---------------------------------------------------------------------------

type ExpiringMembership = Membership & { loyalty_members: Member };

/** Lee la config del programa; si no existe, la crea con los defaults. */
async function loadOrCreateConfig(
  db: SupabaseClient,
  programId: string,
): Promise<NotificationConfig> {
  const { data: existing, error } = await db
    .from("gym_notification_config")
    .select("*")
    .eq("program_id", programId)
    .maybeSingle();

  if (error) throw new Error(`Error al leer configuración: ${error.message}`);
  if (existing) return existing as NotificationConfig;

  const { data: created, error: insertError } = await db
    .from("gym_notification_config")
    .insert({ program_id: programId })
    .select()
    .single();

  if (insertError) throw new Error(`Error al crear configuración: ${insertError.message}`);
  return created as NotificationConfig;
}

/** Membresías del programa que vencen dentro de `alertDays`. */
async function loadExpiringMemberships(
  db: SupabaseClient,
  programId: string,
  alertDays: number,
  limit = 100,
): Promise<ExpiringMembership[]> {
  const now = Date.now();
  const notifyBefore = new Date(now + alertDays * DAY);
  const notifyAfter = new Date(now - DAY); // ignora las vencidas hace más de 1 día

  // `!inner` es obligatorio para poder FILTRAR por una columna del embed
  // (loyalty_members.program_id). Sin él PostgREST no restringe las filas.
  const { data, error } = await db
    .from("gym_memberships")
    .select("*, loyalty_members!inner(id, full_name, phone, email, program_id)")
    .eq("loyalty_members.program_id", programId)
    .gte("expires_at", notifyAfter.toISOString())
    .lte("expires_at", notifyBefore.toISOString())
    .order("expires_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Error al buscar membresías: ${error.message}`);
  return (data ?? []) as ExpiringMembership[];
}

/** Guarda una notificación en el historial. */
async function recordNotification(
  db: SupabaseClient,
  input: {
    memberId: string;
    membershipId?: string | null;
    type: NotificationType;
    channel: NotificationChannel;
    phone: string;
    message: string;
  },
) {
  const { data, error } = await db
    .from("gym_notifications")
    .insert({
      member_id: input.memberId,
      membership_id: input.membershipId ?? null,
      notification_type: input.type,
      channel: input.channel,
      message: input.message,
      // Demo: no hay proveedor real todavía; el envío es manual vía wa.me.
      status: "sent",
      sent_at: new Date().toISOString(),
      metadata: { whatsapp_url: getWhatsAppUrl(input.phone, input.message) },
    })
    .select()
    .single();

  if (error) throw new Error(`Error al registrar notificación: ${error.message}`);
  return data as GymNotification;
}

/** Nombre del negocio dueño del programa (para los mensajes). */
async function loadBusinessName(db: SupabaseClient, programId: string): Promise<string> {
  const { data: program } = await db
    .from("loyalty_programs")
    .select("business_id")
    .eq("id", programId)
    .maybeSingle();
  if (!program) return "el gimnasio";

  const { data: business } = await db
    .from("loyalty_businesses")
    .select("name")
    .eq("id", program.business_id)
    .maybeSingle();

  return business?.name ?? "el gimnasio";
}

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

/** access_token de Supabase Auth (obligatorio: son funciones administrativas). */
const token = z.string().min(1, "Falta el token de sesión");

const programIdSchema = z.object({ token, programId: z.string().uuid() });

/** Membresías próximas a vencer de un programa. */
export const getExpiringMembershipsForNotificationFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token,
      programId: z.string().uuid(),
      alertDays: z.number().int().min(1).max(30),
      limit: z.number().int().positive().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireProgramAccess(data.token, data.programId);
    return loadExpiringMemberships(
      getSupabaseAdmin(),
      data.programId,
      data.alertDays,
      data.limit,
    );
  });

/** Registra una notificación de vencimiento. */
export const sendExpirationNotificationFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token,
      memberId: z.string().uuid(),
      membershipId: z.string().uuid(),
      phone: z.string().min(1),
      message: z.string().min(1),
      channel: z.enum(["whatsapp", "sms", "email"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireMemberAccess(data.token, data.memberId);
    return recordNotification(getSupabaseAdmin(), {
      memberId: data.memberId,
      membershipId: data.membershipId,
      type: "expiration_reminder",
      channel: data.channel ?? "whatsapp",
      phone: data.phone,
      message: data.message,
    });
  });

/** Registra una notificación de bienvenida. */
export const sendWelcomeNotificationFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token,
      memberId: z.string().uuid(),
      phone: z.string().min(1),
      message: z.string().min(1),
      channel: z.enum(["whatsapp", "sms", "email"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireMemberAccess(data.token, data.memberId);
    return recordNotification(getSupabaseAdmin(), {
      memberId: data.memberId,
      type: "welcome",
      channel: data.channel ?? "whatsapp",
      phone: data.phone,
      message: data.message,
    });
  });

/** Config de notificaciones del programa (la crea con defaults si no existe). */
export const getNotificationConfigFn = createServerFn({ method: "POST" })
  .validator(programIdSchema)
  .handler(async ({ data }) => {
    await requireProgramAccess(data.token, data.programId);
    return loadOrCreateConfig(getSupabaseAdmin(), data.programId);
  });

/** Guarda la config de notificaciones (upsert: puede no existir la fila). */
export const updateNotificationConfigFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token,
      programId: z.string().uuid(),
      enabled: z.boolean().optional(),
      preferredChannel: z.enum(["whatsapp", "sms", "email"]).optional(),
      alertDays: z.number().int().min(1).max(30).optional(),
      reminderMessage: z.string().optional(),
      sendWelcomeMsg: z.boolean().optional(),
      welcomeMessage: z.string().optional(),
      notificationTime: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireProgramAccess(data.token, data.programId);
    const db = getSupabaseAdmin();

    const row: Record<string, unknown> = {
      program_id: data.programId,
      updated_at: new Date().toISOString(),
    };
    if (data.enabled !== undefined) row.enabled = data.enabled;
    if (data.preferredChannel !== undefined) row.preferred_channel = data.preferredChannel;
    if (data.alertDays !== undefined) row.alert_days = data.alertDays;
    if (data.reminderMessage !== undefined) row.reminder_message = data.reminderMessage || null;
    if (data.sendWelcomeMsg !== undefined) row.send_welcome_msg = data.sendWelcomeMsg;
    if (data.welcomeMessage !== undefined) row.welcome_message = data.welcomeMessage || null;
    if (data.notificationTime !== undefined) row.notification_time = data.notificationTime;

    const { data: saved, error } = await db
      .from("gym_notification_config")
      .upsert(row, { onConflict: "program_id" })
      .select()
      .single();

    if (error) throw new Error(`Error al guardar configuración: ${error.message}`);
    return saved as NotificationConfig;
  });

/** Dispara las notificaciones de vencimiento del programa (manual / cron). */
export const triggerExpirationNotificationsFn = createServerFn({ method: "POST" })
  .validator(programIdSchema)
  .handler(async ({ data }) => {
    await requireProgramAccess(data.token, data.programId);
    const db = getSupabaseAdmin();
    const config = await loadOrCreateConfig(db, data.programId);

    if (!config.enabled) {
      return { sent: 0, skipped: 0, failed: 0, message: "Notificaciones deshabilitadas" };
    }

    const expiring = await loadExpiringMemberships(db, data.programId, config.alert_days);
    const businessName = await loadBusinessName(db, data.programId);

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const membership of expiring) {
      try {
        const member = membership.loyalty_members;
        if (!member?.phone) {
          skipped++;
          continue;
        }

        // No repetir el aviso si ya se mandó uno en las últimas 24 h.
        const { data: recent } = await db
          .from("gym_notifications")
          .select("id")
          .eq("membership_id", membership.id)
          .eq("notification_type", "expiration_reminder")
          .eq("channel", config.preferred_channel)
          .gte("created_at", new Date(Date.now() - DAY).toISOString());

        if (recent && recent.length > 0) {
          skipped++;
          continue;
        }

        const expiresAt = new Date(membership.expires_at);
        const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / DAY);

        const message = getExpirationMessage(
          member.full_name,
          daysLeft,
          expiresAt,
          businessName,
          config.reminder_message ?? undefined,
        );

        await recordNotification(db, {
          memberId: member.id,
          membershipId: membership.id,
          type: "expiration_reminder",
          channel: config.preferred_channel,
          phone: member.phone,
          message,
        });

        sent++;
      } catch (err) {
        console.error("Error enviando notificación:", err);
        failed++;
      }
    }

    return { sent, skipped, failed };
  });

/** Historial de notificaciones (por miembro o por programa). */
export const getNotificationHistoryFn = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        token,
        memberId: z.string().uuid().optional(),
        programId: z.string().uuid().optional(),
        limit: z.number().int().positive().max(200).optional(),
      })
      // Sin ámbito devolvería el historial de TODA la plataforma.
      .refine((v) => v.memberId || v.programId, {
        message: "Indica memberId o programId",
      }),
  )
  .handler(async ({ data }) => {
    if (data.memberId) await requireMemberAccess(data.token, data.memberId);
    if (data.programId) await requireProgramAccess(data.token, data.programId);

    const db = getSupabaseAdmin();

    let query = db
      .from("gym_notifications")
      .select("*, loyalty_members!member_id(id, full_name, phone)")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);

    if (data.memberId) query = query.eq("member_id", data.memberId);

    if (data.programId) {
      const { data: members } = await db
        .from("loyalty_members")
        .select("id")
        .eq("program_id", data.programId);

      const ids = (members ?? []).map((m) => m.id);
      if (ids.length === 0) return [] as GymNotification[];
      query = query.in("member_id", ids);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(`Error al leer historial: ${error.message}`);
    return (rows ?? []) as GymNotification[];
  });

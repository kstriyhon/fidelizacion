// Sistema de notificaciones para vencimientos y recordatorios del gimnasio.
import { createServerFn } from "@tanstack/react-start";
import { getSupabaseAdmin } from "./supabaseAdmin.server";
import type { Membership } from "./gym-data";
import type { Member } from "./data";

const DAY = 24 * 60 * 60 * 1000; // milliseconds

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type NotificationType = "expiration_reminder" | "welcome" | "referral_activated" | "reward_claimed";
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
  metadata: Record<string, any> | null;
  created_at: string;
  sent_at: string | null;
  updated_at: string;
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
// Funciones de utilidad
// ---------------------------------------------------------------------------

/** Interpola variables en mensaje de notificación. */
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

/** Genera URL de WhatsApp para testing (wa.me). */
export function getWhatsAppUrl(phone: string, message: string): string {
  const encoded = encodeURIComponent(message);
  const cleanPhone = phone.replace(/[^\d]/g, "");
  return `https://wa.me/${cleanPhone}?text=${encoded}`;
}

/** Obtiene mensaje de vencimiento personalizado. */
export function getExpirationMessage(
  memberName: string,
  daysLeft: number,
  expirationDate: Date,
  businessName: string,
  customTemplate?: string,
): string {
  const defaultTemplate =
    "Hola {nombre}, tu membresía en {negocio} vence en {dias} días ({fecha}). Renuévala ahora para no perder acceso 💪";

  const template = customTemplate || defaultTemplate;
  const variables = {
    nombre: memberName,
    dias: daysLeft,
    fecha: expirationDate.toLocaleDateString("es-ES"),
    negocio: businessName,
  };

  return interpolateMessage(template, variables);
}

/** Obtiene mensaje de bienvenida personalizado. */
export function getWelcomeMessage(
  memberName: string,
  businessName: string,
  customTemplate?: string,
): string {
  const defaultTemplate =
    "¡Bienvenido {nombre} a {negocio}! 🏋️ Tu membresía está activa. Accede a tu dashboard para ver tu código de referido y compartir con amigos 💪";

  const template = customTemplate || defaultTemplate;
  const variables = {
    nombre: memberName.split(" ")[0], // Solo nombre de pila
    negocio: businessName,
  };

  return interpolateMessage(template, variables);
}

// ---------------------------------------------------------------------------
// Funciones de servidor
// ---------------------------------------------------------------------------

/** Obtiene membresías próximas a vencer. */
export const getExpiringMembershipsForNotificationFn = createServerFn({
  method: "POST",
  async handler(input: { programId: string; alertDays: number; limit?: number }) {
    const db = getSupabaseAdmin();

    const now = new Date();
    const notifyBefore = new Date(now.getTime() + input.alertDays * DAY);
    const notifyAfter = new Date(now.getTime() - 1 * DAY); // No más viejas de 1 día

    // Obtener membresías activas próximas a vencer
    const { data: memberships, error } = await db
      .from("gym_memberships")
      .select(
        `
        *,
        loyalty_members!member_id (
          id,
          full_name,
          phone,
          email,
          program_id
        )
      `,
      )
      .eq("loyalty_members.program_id", input.programId)
      .gte("expires_at", notifyAfter.toISOString())
      .lte("expires_at", notifyBefore.toISOString())
      .order("expires_at", { ascending: true })
      .limit(input.limit ?? 100);

    if (error) throw new Error(`Error fetching memberships: ${error.message}`);

    return (memberships ?? []) as Array<
      Membership & {
        loyalty_members: Member;
      }
    >;
  },
});

/** Envía notificación de vencimiento por WhatsApp. */
export const sendExpirationNotificationFn = createServerFn({
  method: "POST",
  async handler(input: {
    memberId: string;
    membershipId: string;
    phone: string;
    message: string;
    programId: string;
  }) {
    const db = getSupabaseAdmin();

    // Registrar notificación
    const { data: notification, error: notifError } = await db
      .from("gym_notifications")
      .insert({
        member_id: input.memberId,
        membership_id: input.membershipId,
        notification_type: "expiration_reminder",
        channel: "whatsapp",
        message: input.message,
        status: "sent", // En demo, simplemente marcamos como enviado
        sent_at: new Date().toISOString(),
        metadata: {
          whatsapp_url: getWhatsAppUrl(input.phone, input.message),
        },
      })
      .select()
      .single();

    if (notifError) throw new Error(`Error recording notification: ${notifError.message}`);

    return notification;
  },
});

/** Envía notificación de bienvenida. */
export const sendWelcomeNotificationFn = createServerFn({
  method: "POST",
  async handler(input: {
    memberId: string;
    memberName: string;
    phone: string;
    businessName: string;
    message: string;
  }) {
    const db = getSupabaseAdmin();

    const { data: notification, error } = await db
      .from("gym_notifications")
      .insert({
        member_id: input.memberId,
        notification_type: "welcome",
        channel: "whatsapp",
        message: input.message,
        status: "sent",
        sent_at: new Date().toISOString(),
        metadata: {
          whatsapp_url: getWhatsAppUrl(input.phone, input.message),
        },
      })
      .select()
      .single();

    if (error) throw new Error(`Error sending welcome: ${error.message}`);

    return notification;
  },
});

/** Obtiene configuración de notificaciones de un programa. */
export const getNotificationConfigFn = createServerFn({
  method: "POST",
  async handler(input: { programId: string }) {
    const db = getSupabaseAdmin();

    const { data, error } = await db
      .from("gym_notification_config")
      .select("*")
      .eq("program_id", input.programId)
      .single();

    if (error) {
      // Si no existe, crear con defaults
      if (error.code === "PGRST116") {
        const { data: created } = await db
          .from("gym_notification_config")
          .insert({
            program_id: input.programId,
            enabled: true,
            preferred_channel: "whatsapp",
            alert_days: 7,
            send_welcome_msg: true,
            notification_time: "09:00",
          })
          .select()
          .single();
        return created as NotificationConfig;
      }
      throw new Error(`Error fetching config: ${error.message}`);
    }

    return data as NotificationConfig;
  },
});

/** Actualiza configuración de notificaciones. */
export const updateNotificationConfigFn = createServerFn({
  method: "POST",
  async handler(input: {
    programId: string;
    enabled?: boolean;
    preferredChannel?: NotificationChannel;
    alertDays?: number;
    reminderMessage?: string;
    sendWelcomeMsg?: boolean;
    welcomeMessage?: string;
    notificationTime?: string;
  }) {
    const db = getSupabaseAdmin();

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (input.enabled !== undefined) updates.enabled = input.enabled;
    if (input.preferredChannel) updates.preferred_channel = input.preferredChannel;
    if (input.alertDays !== undefined) updates.alert_days = input.alertDays;
    if (input.reminderMessage !== undefined) updates.reminder_message = input.reminderMessage;
    if (input.sendWelcomeMsg !== undefined) updates.send_welcome_msg = input.sendWelcomeMsg;
    if (input.welcomeMessage !== undefined) updates.welcome_message = input.welcomeMessage;
    if (input.notificationTime) updates.notification_time = input.notificationTime;

    const { data, error } = await db
      .from("gym_notification_config")
      .update(updates)
      .eq("program_id", input.programId)
      .select()
      .single();

    if (error) throw new Error(`Error updating config: ${error.message}`);

    return data as NotificationConfig;
  },
});

/** Dispara notificaciones de vencimiento para un programa. (para testing/cron) */
export const triggerExpirationNotificationsFn = createServerFn({
  method: "POST",
  async handler(input: { programId: string }) {
    const db = getSupabaseAdmin();

    // Obtener configuración
    const config = await getNotificationConfigFn({ programId: input.programId });

    if (!config.enabled) {
      return { sent: 0, skipped: 0, failed: 0, message: "Notificaciones deshabilitadas" };
    }

    // Obtener membresías próximas a vencer
    const expiringMemberships = await getExpiringMembershipsForNotificationFn({
      programId: input.programId,
      alertDays: config.alert_days,
    });

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const membership of expiringMemberships) {
      try {
        const member = membership.loyalty_members;

        // Verificar si ya se envió notificación recientemente (en últimas 24h)
        const { data: recentNotifications } = await db
          .from("gym_notifications")
          .select("id")
          .eq("membership_id", membership.id)
          .eq("notification_type", "expiration_reminder")
          .eq("channel", config.preferred_channel)
          .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        if (recentNotifications && recentNotifications.length > 0) {
          skipped++;
          continue;
        }

        if (!member.phone) {
          skipped++;
          continue;
        }

        // Calcular días restantes
        const expiresAt = new Date(membership.expires_at);
        const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / DAY);

        // Obtener datos del negocio
        const { data: program } = await db
          .from("loyalty_programs")
          .select("*, loyalty_businesses!business_id(*)")
          .eq("id", member.program_id)
          .single();

        if (!program) {
          failed++;
          continue;
        }

        // Generar mensaje
        const message = getExpirationMessage(
          member.full_name,
          daysLeft,
          expiresAt,
          program.loyalty_businesses?.name ?? "el gimnasio",
          config.reminder_message ?? undefined,
        );

        // Enviar notificación
        await sendExpirationNotificationFn({
          memberId: member.id,
          membershipId: membership.id,
          phone: member.phone,
          message,
          programId: input.programId,
        });

        sent++;
      } catch (err) {
        console.error("Error sending notification:", err);
        failed++;
      }
    }

    return { sent, skipped, failed };
  },
});

/** Obtiene historial de notificaciones. */
export const getNotificationHistoryFn = createServerFn({
  method: "POST",
  async handler(input: { memberId?: string; programId?: string; limit?: number }) {
    const db = getSupabaseAdmin();

    let query = db
      .from("gym_notifications")
      .select(
        `
        *,
        loyalty_members!member_id (id, full_name, phone)
      `,
      )
      .order("created_at", { ascending: false })
      .limit(input.limit ?? 50);

    if (input.memberId) {
      query = query.eq("member_id", input.memberId);
    }

    if (input.programId) {
      query = query.in(
        "member_id",
        (
          await db
            .from("loyalty_members")
            .select("id")
            .eq("program_id", input.programId)
        ).data?.map((m) => m.id) ?? [],
      );
    }

    const { data, error } = await query;

    if (error) throw new Error(`Error fetching history: ${error.message}`);

    return data ?? [];
  },
});

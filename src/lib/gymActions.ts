// Server functions para el módulo de gimnasio.
//
// IMPORTANTE (API de TanStack Start): las server functions se declaran con el
// builder `createServerFn({ method }).validator(schema).handler(async ({ data }) => …)`
// y se INVOCAN como `fn({ data: { … } })`. Pasar `handler` dentro del objeto de
// opciones (`createServerFn({ method, handler })`) NO funciona: ese handler se
// ignora silenciosamente y la ruta acaba fallando. Mismo patrón que loyaltyActions.ts.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { AttendanceSession } from "./gym-data";
import { getSupabaseAdmin } from "./supabaseAdmin.server";
import { requireProgramAccess, requireMemberAccess } from "./authz.server";

// AUTORIZACIÓN (Fase 2). Estas funciones usan el cliente service_role, que se
// salta la RLS, así que CADA UNA debe autorizar por su cuenta. Criterio:
//
//  - PÚBLICAS a propósito (sin token): la inscripción, la landing de referido y
//    el dashboard del miembro con su check-in/out. El miembro no tiene cuenta;
//    el control de acceso es que la URL lleva su UUID (el mismo del QR). Todas
//    operan SOLO sobre el memberId de la URL, así que no dan acceso a terceros.
//  - RESTO (panel, membresías, reportes, config, notificaciones): exigen `token`
//    y que quien llama sea DUEÑO del negocio o ADMIN.

/** Duraciones por defecto si el programa aún no tiene fila en gym_program_config. */
const DEFAULT_DAYS = { monthly: 30, quarterly: 90, annual: 365 } as const;

const memberIdSchema = z.object({ memberId: z.string().uuid() });
const programIdSchema = z.object({ programId: z.string().uuid() });

/** access_token de Supabase Auth: lo exigen las funciones administrativas. */
const token = z.string().min(1, "Falta el token de sesión");

/** Obtiene el dashboard completo del miembro en el gimnasio. */
export const getGymMemberDashboardFn = createServerFn({ method: "POST" })
  .validator(memberIdSchema)
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();

    const { data: member, error: memberError } = await db
      .from("loyalty_members")
      .select("*")
      .eq("id", data.memberId)
      .maybeSingle();

    if (memberError) throw new Error(`Error al buscar miembro: ${memberError.message}`);
    if (!member) throw new Error("Miembro no encontrado");

    const { data: program, error: programError } = await db
      .from("loyalty_programs")
      .select("*")
      .eq("id", member.program_id)
      .maybeSingle();

    if (programError) throw new Error(`Error al buscar programa: ${programError.message}`);
    if (!program) throw new Error("Programa no encontrado");

    // Membresía más reciente (puede no existir todavía).
    const { data: membership } = await db
      .from("gym_memberships")
      .select("*")
      .eq("member_id", data.memberId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Historial de asistencia (últimos 30 días).
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: attendance } = await db
      .from("gym_attendance")
      .select("*")
      .eq("member_id", data.memberId)
      .gte("timestamp_at", thirtyDaysAgo.toISOString())
      .order("timestamp_at", { ascending: false });

    // Agrupar asistencias por día y calcular duraciones.
    const sessionsByDate = new Map<string, AttendanceSession>();
    for (const record of attendance ?? []) {
      const date = record.timestamp_at.split("T")[0];
      let session = sessionsByDate.get(date);
      if (!session) {
        session = { date, check_in: null, check_out: null, duration_minutes: null };
        sessionsByDate.set(date, session);
      }
      if (record.event_type === "check_in") session.check_in = record.timestamp_at;
      else session.check_out = record.timestamp_at;
    }
    for (const session of sessionsByDate.values()) {
      if (session.check_in && session.check_out) {
        const checkIn = new Date(session.check_in).getTime();
        const checkOut = new Date(session.check_out).getTime();
        session.duration_minutes = Math.round((checkOut - checkIn) / 60000);
      }
    }
    const recentSessions = Array.from(sessionsByDate.values()).sort((a, b) =>
      b.date.localeCompare(a.date),
    );

    const { data: referrals } = await db
      .from("gym_referrals")
      .select("*")
      .eq("referrer_id", data.memberId)
      .order("created_at", { ascending: false });

    const { data: config } = await db
      .from("gym_program_config")
      .select("*")
      .eq("program_id", member.program_id)
      .maybeSingle();

    return {
      member,
      program,
      membership: membership ?? null,
      recentSessions,
      referrals: referrals ?? [],
      config: config ?? null,
    };
  });

/** Realiza check-in del miembro. */
export const checkInMemberFn = createServerFn({ method: "POST" })
  .validator(memberIdSchema)
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();

    const { data: membership } = await db
      .from("gym_memberships")
      .select("*")
      .eq("member_id", data.memberId)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!membership) throw new Error("No tienes una membresía");
    if (membership.payment_status !== "up_to_date") {
      throw new Error("Tu membresía no está al día");
    }
    if (new Date(membership.expires_at) < new Date()) {
      throw new Error("Tu membresía está vencida");
    }

    const { data: inserted, error } = await db
      .from("gym_attendance")
      .insert({
        member_id: data.memberId,
        timestamp_at: new Date().toISOString(),
        event_type: "check_in",
        entry_method: "manual",
      })
      .select()
      .single();

    if (error) throw new Error(`Error al registrar entrada: ${error.message}`);
    return inserted;
  });

/** Realiza check-out del miembro. */
export const checkOutMemberFn = createServerFn({ method: "POST" })
  .validator(memberIdSchema)
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();

    const { data: lastCheckIn } = await db
      .from("gym_attendance")
      .select("id, timestamp_at")
      .eq("member_id", data.memberId)
      .eq("event_type", "check_in")
      .order("timestamp_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastCheckIn) throw new Error("No hay check-in registrado");

    const durationMinutes = Math.round(
      (Date.now() - new Date(lastCheckIn.timestamp_at).getTime()) / 60000,
    );

    const { data: inserted, error } = await db
      .from("gym_attendance")
      .insert({
        member_id: data.memberId,
        timestamp_at: new Date().toISOString(),
        event_type: "check_out",
        duration_minutes: durationMinutes,
        entry_method: "manual",
      })
      .select()
      .single();

    if (error) throw new Error(`Error al registrar salida: ${error.message}`);
    return { attendance: inserted, durationMinutes };
  });

/** Obtiene o crea un referral code para el miembro. */
export const getOrCreateReferralCodeFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      memberId: z.string().uuid(),
      rewardType: z.enum(["discount", "stamps", "free_days"]).optional(),
      rewardValue: z.number().int().positive().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();

    const { data: existing } = await db
      .from("gym_referrals")
      .select("*")
      .eq("referrer_id", data.memberId)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();

    if (existing) return existing;

    const rand = () => Math.random().toString(36).substring(2, 8).toUpperCase();
    const code = `REF-${rand()}${rand()}`;

    const { data: inserted, error } = await db
      .from("gym_referrals")
      .insert({
        referrer_id: data.memberId,
        referral_code: code,
        reward_type: data.rewardType ?? "discount",
        reward_value: data.rewardValue ?? 10,
        status: "pending",
      })
      .select()
      .single();

    if (error) throw new Error(`Error al crear código de referido: ${error.message}`);
    return inserted;
  });

/** Obtiene resumen de referrals del miembro. */
export const getReferralSummaryFn = createServerFn({ method: "POST" })
  .validator(memberIdSchema)
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();

    const { data: referrals } = await db
      .from("gym_referrals")
      .select("*")
      .eq("referrer_id", data.memberId);

    const summary = { pending: 0, activated: 0, claimed: 0, totalReward: 0 };
    for (const ref of referrals ?? []) {
      if (ref.status === "pending") summary.pending++;
      else if (ref.status === "activated") summary.activated++;
      else if (ref.status === "claimed") summary.claimed++;
      summary.totalReward += ref.reward_value;
    }
    return summary;
  });

// ---------------------------------------------------------------------------
// PANEL ADMIN
// ---------------------------------------------------------------------------

/** Obtiene dashboard admin del gimnasio para un programa. */
export const getGymAdminDashboardFn = createServerFn({ method: "POST" })
  .validator(programIdSchema.extend({ token }))
  .handler(async ({ data }) => {
    await requireProgramAccess(data.token, data.programId);
    const db = getSupabaseAdmin();

    const { data: program } = await db
      .from("loyalty_programs")
      .select("*")
      .eq("id", data.programId)
      .maybeSingle();

    if (!program) throw new Error("Programa no encontrado");

    const { data: business } = await db
      .from("loyalty_businesses")
      .select("*")
      .eq("id", program.business_id)
      .maybeSingle();

    const { data: members } = await db
      .from("loyalty_members")
      .select("*")
      .eq("program_id", data.programId);

    const memberIds = (members ?? []).map((m) => m.id);

    // `.in()` con lista vacía devuelve 0 filas; evitamos la llamada.
    const memberships = memberIds.length
      ? (await db.from("gym_memberships").select("*").in("member_id", memberIds)).data
      : [];

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const attendance = memberIds.length
      ? (
          await db
            .from("gym_attendance")
            .select("*")
            .gte("timestamp_at", monthStart.toISOString())
            .in("member_id", memberIds)
        ).data
      : [];

    const referrals = memberIds.length
      ? (await db.from("gym_referrals").select("*").in("referrer_id", memberIds)).data
      : [];

    const { data: config } = await db
      .from("gym_program_config")
      .select("*")
      .eq("program_id", data.programId)
      .maybeSingle();

    return {
      program,
      business: business ?? null,
      members: members ?? [],
      memberships: memberships ?? [],
      attendance: attendance ?? [],
      config: config ?? null,
      referrals: referrals ?? [],
    };
  });

/** Crea o renueva membresía para un miembro. */
export const createMembershipFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token,
      memberId: z.string().uuid(),
      type: z.enum(["monthly", "quarterly", "annual"]),
    }),
  )
  .handler(async ({ data }) => {
    await requireMemberAccess(data.token, data.memberId);
    const db = getSupabaseAdmin();

    const { data: member } = await db
      .from("loyalty_members")
      .select("program_id")
      .eq("id", data.memberId)
      .maybeSingle();

    if (!member) throw new Error("Miembro no encontrado");

    // La config es opcional: si el programa no la tiene, usamos los defaults.
    const { data: config } = await db
      .from("gym_program_config")
      .select("*")
      .eq("program_id", member.program_id)
      .maybeSingle();

    const days = config
      ? { monthly: config.monthly_days, quarterly: config.quarterly_days, annual: config.annual_days }[
          data.type
        ]
      : DEFAULT_DAYS[data.type];

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    const { data: inserted, error } = await db
      .from("gym_memberships")
      .insert({
        member_id: data.memberId,
        membership_type: data.type,
        expires_at: expiresAt.toISOString(),
        payment_status: "up_to_date",
      })
      .select()
      .single();

    if (error) throw new Error(`Error al crear membresía: ${error.message}`);
    return inserted;
  });

/** Actualiza el estado de pago de una membresía. */
export const updateMembershipPaymentStatusFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token,
      membershipId: z.string().uuid(),
      status: z.enum(["up_to_date", "overdue", "paused"]),
    }),
  )
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();

    // La membresía no dice a qué programa pertenece: hay que pasar por el miembro.
    const { data: membership } = await db
      .from("gym_memberships")
      .select("member_id")
      .eq("id", data.membershipId)
      .maybeSingle();

    if (!membership) throw new Error("Membresía no encontrada");
    await requireMemberAccess(data.token, membership.member_id as string);

    const { data: updated, error } = await db
      .from("gym_memberships")
      .update({ payment_status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.membershipId)
      .select()
      .single();

    if (error) throw new Error(`Error al actualizar membresía: ${error.message}`);
    return updated;
  });

/** Historial de asistencias de un miembro en un rango de fechas. */
export const getMemberAttendanceHistoryFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token,
      memberId: z.string().uuid(),
      startDate: z.string(),
      endDate: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    await requireMemberAccess(data.token, data.memberId);
    const db = getSupabaseAdmin();

    const { data: rows, error } = await db
      .from("gym_attendance")
      .select("*")
      .eq("member_id", data.memberId)
      .gte("timestamp_at", data.startDate)
      .lte("timestamp_at", data.endDate)
      .order("timestamp_at", { ascending: false });

    if (error) throw new Error(`Error al obtener asistencias: ${error.message}`);
    return rows ?? [];
  });

/** Crea o actualiza la configuración del programa de gimnasio (upsert). */
export const updateGymProgramConfigFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token,
      programId: z.string().uuid(),
      monthlyDays: z.number().int().optional(),
      monthlyPrice: z.number().optional(),
      quarterlyDays: z.number().int().optional(),
      quarterlyPrice: z.number().optional(),
      annualDays: z.number().int().optional(),
      annualPrice: z.number().optional(),
      notifyDays: z.number().int().optional(),
      autoCheckin: z.boolean().optional(),
      autoCheckoutMinutes: z.number().int().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireProgramAccess(data.token, data.programId);
    const db = getSupabaseAdmin();

    const row: Record<string, unknown> = {
      program_id: data.programId,
      updated_at: new Date().toISOString(),
    };
    if (data.monthlyDays !== undefined) row.monthly_days = data.monthlyDays;
    if (data.monthlyPrice !== undefined) row.monthly_price = data.monthlyPrice;
    if (data.quarterlyDays !== undefined) row.quarterly_days = data.quarterlyDays;
    if (data.quarterlyPrice !== undefined) row.quarterly_price = data.quarterlyPrice;
    if (data.annualDays !== undefined) row.annual_days = data.annualDays;
    if (data.annualPrice !== undefined) row.annual_price = data.annualPrice;
    if (data.notifyDays !== undefined) row.notify_days = data.notifyDays;
    if (data.autoCheckin !== undefined) row.auto_checkin = data.autoCheckin;
    if (data.autoCheckoutMinutes !== undefined)
      row.auto_checkout_minutes = data.autoCheckoutMinutes;

    // upsert: el programa puede no tener fila de config todavía.
    const { data: saved, error } = await db
      .from("gym_program_config")
      .upsert(row, { onConflict: "program_id" })
      .select()
      .single();

    if (error) throw new Error(`Error al guardar configuración: ${error.message}`);
    return saved;
  });

/** Reporte de asistencia del mes actual. */
export const getMonthlyAttendanceReportFn = createServerFn({ method: "POST" })
  .validator(programIdSchema.extend({ token }))
  .handler(async ({ data }) => {
    await requireProgramAccess(data.token, data.programId);
    const db = getSupabaseAdmin();

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthEnd = new Date();
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    monthEnd.setDate(0);
    monthEnd.setHours(23, 59, 59, 999);

    const { data: members } = await db
      .from("loyalty_members")
      .select("*")
      .eq("program_id", data.programId);

    if (!members || members.length === 0) {
      return { totalMembers: 0, activeMembers: 0, attendedThisMonth: 0, data: [] };
    }

    const memberIds = members.map((m) => m.id);

    const { data: attendance } = await db
      .from("gym_attendance")
      .select("*")
      .in("member_id", memberIds)
      .gte("timestamp_at", monthStart.toISOString())
      .lte("timestamp_at", monthEnd.toISOString());

    const attendedSet = new Set<string>();
    const sessionsByMember = new Map<string, number>();
    for (const a of attendance ?? []) {
      if (a.event_type !== "check_in") continue;
      attendedSet.add(a.member_id);
      sessionsByMember.set(a.member_id, (sessionsByMember.get(a.member_id) ?? 0) + 1);
    }

    const report = members
      .map((member) => ({
        id: member.id,
        name: member.full_name,
        attended: attendedSet.has(member.id),
        sessions: sessionsByMember.get(member.id) ?? 0,
      }))
      .sort((a, b) => b.sessions - a.sessions);

    return {
      totalMembers: members.length,
      activeMembers: attendedSet.size,
      attendedThisMonth: attendedSet.size,
      data: report,
    };
  });

// ---------------------------------------------------------------------------
// INSCRIPCIÓN PÚBLICA
// ---------------------------------------------------------------------------

/** Inscribe un nuevo miembro en un programa de gimnasio. */
export const enrollGymMemberFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      programId: z.string().uuid(),
      fullName: z.string().min(2),
      phone: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
      referralCode: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();

    const { data: program } = await db
      .from("loyalty_programs")
      .select("*")
      .eq("id", data.programId)
      .maybeSingle();

    if (!program) throw new Error("Programa no encontrado");

    const { data: member, error: memberError } = await db
      .from("loyalty_members")
      .insert({
        program_id: data.programId,
        full_name: data.fullName.trim(),
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
      })
      .select()
      .single();

    if (memberError || !member) {
      throw new Error(`Error al crear miembro: ${memberError?.message ?? ""}`);
    }

    const { data: config } = await db
      .from("gym_program_config")
      .select("*")
      .eq("program_id", data.programId)
      .maybeSingle();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (config?.monthly_days ?? DEFAULT_DAYS.monthly));

    const { data: membership, error: membershipError } = await db
      .from("gym_memberships")
      .insert({
        member_id: member.id,
        membership_type: "monthly",
        expires_at: expiresAt.toISOString(),
        payment_status: "up_to_date",
      })
      .select()
      .single();

    if (membershipError || !membership) {
      throw new Error(`Error al crear membresía: ${membershipError?.message ?? ""}`);
    }

    // Si vino con código de referido, lo activamos.
    if (data.referralCode) {
      const { data: referral } = await db
        .from("gym_referrals")
        .select("*")
        .eq("referral_code", data.referralCode)
        .eq("status", "pending")
        .maybeSingle();

      if (referral) {
        await db
          .from("gym_referrals")
          .update({
            referree_id: member.id,
            status: "activated",
            activated_at: new Date().toISOString(),
          })
          .eq("id", referral.id);
      }
    }

    return { member, membership };
  });

/** Datos para la página de inscripción por código de referido. */
export const getReferralInscriptionDataFn = createServerFn({ method: "POST" })
  .validator(z.object({ referralCode: z.string().min(1) }))
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();

    const { data: referral } = await db
      .from("gym_referrals")
      .select("*")
      .eq("referral_code", data.referralCode)
      .eq("status", "pending")
      .maybeSingle();

    if (!referral) throw new Error("Código de referido inválido o ya canjeado");

    const { data: referrer } = await db
      .from("loyalty_members")
      .select("*")
      .eq("id", referral.referrer_id)
      .maybeSingle();

    if (!referrer) throw new Error("Referidor no encontrado");

    // loyalty_members no tiene business_id: hay que pasar por el programa.
    const { data: program } = await db
      .from("loyalty_programs")
      .select("*")
      .eq("id", referrer.program_id)
      .maybeSingle();

    const { data: business } = program
      ? await db.from("loyalty_businesses").select("*").eq("id", program.business_id).maybeSingle()
      : { data: null };

    return {
      referral,
      // La UI lee `referrer.loyalty_businesses` — lo componemos aquí.
      referrer: { ...referrer, loyalty_programs: program ?? null, loyalty_businesses: business ?? null },
      programId: referrer.program_id,
    };
  });

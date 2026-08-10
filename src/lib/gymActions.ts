// Server functions para el módulo de gimnasio.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Membership, Attendance, Referral, GymProgramConfig, AttendanceSession } from "./gym-data";
import { getSupabaseAdmin } from "./supabaseAdmin.server";

/** Obtiene el dashboard completo del miembro en el gimnasio. */
export const getGymMemberDashboardFn = createServerFn({
  method: "POST",
  async handler(input: { memberId: string }) {
    const db = getSupabaseAdmin();

    // Obtener datos del miembro y su programa
    const { data: member, error: memberError } = await db
      .from("loyalty_members")
      .select("*")
      .eq("id", input.memberId)
      .single();

    if (memberError || !member) throw new Error("Miembro no encontrado");

    const { data: program, error: programError } = await db
      .from("loyalty_programs")
      .select("*")
      .eq("id", member.program_id)
      .single();

    if (programError || !program) throw new Error("Programa no encontrado");

    // Obtener membresía activa del gimnasio
    const { data: membership, error: membershipError } = await db
      .from("gym_memberships")
      .select("*")
      .eq("member_id", input.memberId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Obtener historial de asistencia (últimos 30 días)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: attendance, error: attendanceError } = await db
      .from("gym_attendance")
      .select("*")
      .eq("member_id", input.memberId)
      .gte("timestamp_at", thirtyDaysAgo.toISOString())
      .order("timestamp_at", { ascending: false });

    // Agrupar asistencias por día
    const sessionsByDate = new Map<string, AttendanceSession>();
    if (attendance) {
      for (const record of attendance) {
        const date = record.timestamp_at.split("T")[0];
        let session = sessionsByDate.get(date);
        if (!session) {
          session = { date, check_in: null, check_out: null, duration_minutes: null };
          sessionsByDate.set(date, session);
        }

        if (record.event_type === "check_in") {
          session.check_in = record.timestamp_at;
        } else {
          session.check_out = record.timestamp_at;
        }
      }

      // Calcular duraciones
      for (const session of sessionsByDate.values()) {
        if (session.check_in && session.check_out) {
          const checkIn = new Date(session.check_in).getTime();
          const checkOut = new Date(session.check_out).getTime();
          session.duration_minutes = Math.round((checkOut - checkIn) / 60000);
        }
      }
    }

    const recentSessions = Array.from(sessionsByDate.values()).sort((a, b) =>
      b.date.localeCompare(a.date),
    );

    // Obtener referrals del miembro
    const { data: referrals, error: referralsError } = await db
      .from("gym_referrals")
      .select("*")
      .eq("referrer_id", input.memberId)
      .order("created_at", { ascending: false });

    // Obtener configuración del programa de gimnasio
    const { data: config, error: configError } = await db
      .from("gym_program_config")
      .select("*")
      .eq("program_id", member.program_id)
      .single();

    return {
      member,
      program,
      membership: membership ?? null,
      recentSessions,
      referrals: referrals ?? [],
      config: config ?? null,
    };
  },
});

/** Realiza check-in del miembro. */
export const checkInMemberFn = createServerFn({
  method: "POST",
  async handler(input: { memberId: string }) {
    const db = getSupabaseAdmin();

    // Verificar que haya membresía activa
    const { data: membership } = await db
      .from("gym_memberships")
      .select("*")
      .eq("member_id", input.memberId)
      .eq("payment_status", "up_to_date")
      .single();

    if (!membership) throw new Error("No tienes una membresía activa");

    // Registrar check-in
    const { data, error } = await db
      .from("gym_attendance")
      .insert({
        member_id: input.memberId,
        timestamp_at: new Date().toISOString(),
        event_type: "check_in",
        entry_method: "manual",
      })
      .select()
      .single();

    if (error) throw new Error(`Error al registrar entrada: ${error.message}`);

    return data;
  },
});

/** Realiza check-out del miembro. */
export const checkOutMemberFn = createServerFn({
  method: "POST",
  async handler(input: { memberId: string }) {
    const db = getSupabaseAdmin();

    // Buscar el último check-in sin check-out
    const { data: lastCheckIn, error: checkInError } = await db
      .from("gym_attendance")
      .select("id, timestamp_at")
      .eq("member_id", input.memberId)
      .eq("event_type", "check_in")
      .order("timestamp_at", { ascending: false })
      .limit(1)
      .single();

    if (checkInError || !lastCheckIn) {
      throw new Error("No hay check-in registrado");
    }

    const checkInTime = new Date(lastCheckIn.timestamp_at).getTime();
    const checkOutTime = Date.now();
    const durationMinutes = Math.round((checkOutTime - checkInTime) / 60000);

    const { data, error } = await db
      .from("gym_attendance")
      .insert({
        member_id: input.memberId,
        timestamp_at: new Date().toISOString(),
        event_type: "check_out",
        duration_minutes: durationMinutes,
        entry_method: "manual",
      })
      .select()
      .single();

    if (error) throw new Error(`Error al registrar salida: ${error.message}`);

    return { attendance: data, durationMinutes };
  },
});

/** Obtiene o crea un referral code para el miembro. */
export const getOrCreateReferralCodeFn = createServerFn({
  method: "POST",
  async handler(input: { memberId: string; rewardType?: string; rewardValue?: number }) {
    const db = getSupabaseAdmin();

    // Buscar referral existente
    const { data: existing } = await db
      .from("gym_referrals")
      .select("*")
      .eq("referrer_id", input.memberId)
      .eq("status", "pending")
      .limit(1)
      .single();

    if (existing) return existing;

    // Crear nuevo referral code
    const code = `REF-${Math.random().toString(36).substring(2, 8).toUpperCase()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const { data, error } = await db
      .from("gym_referrals")
      .insert({
        referrer_id: input.memberId,
        referral_code: code,
        reward_type: input.rewardType ?? "discount",
        reward_value: input.rewardValue ?? 10,
        status: "pending",
      })
      .select()
      .single();

    if (error) throw new Error(`Error al crear código de referido: ${error.message}`);

    return data;
  },
});

/** Obtiene resumen de referrals del miembro. */
export const getReferralSummaryFn = createServerFn({
  method: "POST",
  async handler(input: { memberId: string }) {
    const db = getSupabaseAdmin();

    const { data: referrals } = await db
      .from("gym_referrals")
      .select("*")
      .eq("referrer_id", input.memberId);

    if (!referrals) return { pending: 0, activated: 0, claimed: 0, totalReward: 0 };

    let pending = 0;
    let activated = 0;
    let claimed = 0;
    let totalReward = 0;

    for (const ref of referrals) {
      if (ref.status === "pending") pending++;
      else if (ref.status === "activated") activated++;
      else if (ref.status === "claimed") claimed++;
      totalReward += ref.reward_value;
    }

    return { pending, activated, claimed, totalReward };
  },
});

// ---------------------------------------------------------------------------
// ADMIN PANEL FUNCTIONS
// ---------------------------------------------------------------------------

/** Obtiene dashboard admin del gimnasio para un programa. */
export const getGymAdminDashboardFn = createServerFn({
  method: "POST",
  async handler(input: { programId: string }) {
    const db = getSupabaseAdmin();

    // Obtener programa y negocio
    const { data: program } = await db
      .from("loyalty_programs")
      .select("*")
      .eq("id", input.programId)
      .single();

    if (!program) throw new Error("Programa no encontrado");

    const { data: business } = await db
      .from("loyalty_businesses")
      .select("*")
      .eq("id", program.business_id)
      .single();

    // Obtener todos los miembros del programa
    const { data: members } = await db
      .from("loyalty_members")
      .select("*")
      .eq("program_id", input.programId);

    // Obtener membresías de todos los miembros
    const { data: memberships } = await db
      .from("gym_memberships")
      .select("*")
      .in(
        "member_id",
        members?.map((m) => m.id) ?? [],
      );

    // Obtener asistencias del mes actual
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const { data: attendance } = await db
      .from("gym_attendance")
      .select("*")
      .gte("timestamp_at", monthStart.toISOString())
      .in(
        "member_id",
        members?.map((m) => m.id) ?? [],
      );

    // Obtener configuración del programa
    const { data: config } = await db
      .from("gym_program_config")
      .select("*")
      .eq("program_id", input.programId)
      .single();

    // Obtener referrals activos
    const { data: referrals } = await db
      .from("gym_referrals")
      .select("*")
      .in(
        "referrer_id",
        members?.map((m) => m.id) ?? [],
      );

    return {
      program,
      business,
      members: members ?? [],
      memberships: memberships ?? [],
      attendance: attendance ?? [],
      config: config ?? null,
      referrals: referrals ?? [],
    };
  },
});

/** Crea o renueva membresía para un miembro. */
export const createMembershipFn = createServerFn({
  method: "POST",
  async handler(input: { memberId: string; type: "monthly" | "quarterly" | "annual" }) {
    const db = getSupabaseAdmin();

    // Obtener configuración del programa
    const { data: member } = await db
      .from("loyalty_members")
      .select("program_id")
      .eq("id", input.memberId)
      .single();

    if (!member) throw new Error("Miembro no encontrado");

    const { data: config } = await db
      .from("gym_program_config")
      .select("*")
      .eq("program_id", member.program_id)
      .single();

    if (!config) throw new Error("Configuración del programa no encontrada");

    const daysMap = {
      monthly: config.monthly_days,
      quarterly: config.quarterly_days,
      annual: config.annual_days,
    };

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + daysMap[input.type]);

    const { data, error } = await db
      .from("gym_memberships")
      .insert({
        member_id: input.memberId,
        membership_type: input.type,
        expires_at: expiresAt.toISOString(),
        payment_status: "up_to_date",
      })
      .select()
      .single();

    if (error) throw new Error(`Error al crear membresía: ${error.message}`);

    return data;
  },
});

/** Actualiza el estado de pago de una membresía. */
export const updateMembershipPaymentStatusFn = createServerFn({
  method: "POST",
  async handler(input: {
    membershipId: string;
    status: "up_to_date" | "overdue" | "paused";
  }) {
    const db = getSupabaseAdmin();

    const { data, error } = await db
      .from("gym_memberships")
      .update({
        payment_status: input.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.membershipId)
      .select()
      .single();

    if (error) throw new Error(`Error al actualizar membresía: ${error.message}`);

    return data;
  },
});

/** Obtiene el historial de asistencias de un miembro en un rango de fechas. */
export const getMemberAttendanceHistoryFn = createServerFn({
  method: "POST",
  async handler(input: { memberId: string; startDate: string; endDate: string }) {
    const db = getSupabaseAdmin();

    const { data, error } = await db
      .from("gym_attendance")
      .select("*")
      .eq("member_id", input.memberId)
      .gte("timestamp_at", input.startDate)
      .lte("timestamp_at", input.endDate)
      .order("timestamp_at", { ascending: false });

    if (error) throw new Error(`Error al obtener asistencias: ${error.message}`);

    return data ?? [];
  },
});

/** Actualiza la configuración del programa de gimnasio. */
export const updateGymProgramConfigFn = createServerFn({
  method: "POST",
  async handler(input: {
    programId: string;
    monthlyDays?: number;
    monthlyPrice?: number;
    quarterlyDays?: number;
    quarterlyPrice?: number;
    annualDays?: number;
    annualPrice?: number;
    notifyDays?: number;
    autoCheckin?: boolean;
    autoCheckoutMinutes?: number;
  }) {
    const db = getSupabaseAdmin();

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (input.monthlyDays !== undefined) updates.monthly_days = input.monthlyDays;
    if (input.monthlyPrice !== undefined) updates.monthly_price = input.monthlyPrice;
    if (input.quarterlyDays !== undefined) updates.quarterly_days = input.quarterlyDays;
    if (input.quarterlyPrice !== undefined) updates.quarterly_price = input.quarterlyPrice;
    if (input.annualDays !== undefined) updates.annual_days = input.annualDays;
    if (input.annualPrice !== undefined) updates.annual_price = input.annualPrice;
    if (input.notifyDays !== undefined) updates.notify_days = input.notifyDays;
    if (input.autoCheckin !== undefined) updates.auto_checkin = input.autoCheckin;
    if (input.autoCheckoutMinutes !== undefined)
      updates.auto_checkout_minutes = input.autoCheckoutMinutes;

    const { data, error } = await db
      .from("gym_program_config")
      .update(updates)
      .eq("program_id", input.programId)
      .select()
      .single();

    if (error) throw new Error(`Error al actualizar configuración: ${error.message}`);

    return data;
  },
});

/** Obtiene reportes de asistencia del mes actual. */
export const getMonthlyAttendanceReportFn = createServerFn({
  method: "POST",
  async handler(input: { programId: string }) {
    const db = getSupabaseAdmin();

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthEnd = new Date();
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    monthEnd.setDate(0);
    monthEnd.setHours(23, 59, 59, 999);

    // Obtener miembros del programa
    const { data: members } = await db
      .from("loyalty_members")
      .select("*")
      .eq("program_id", input.programId);

    if (!members) return { totalMembers: 0, activeMembers: 0, attendedThisMonth: 0, data: [] };

    const memberIds = members.map((m) => m.id);

    // Obtener asistencias del mes
    const { data: attendance } = await db
      .from("gym_attendance")
      .select("*")
      .in("member_id", memberIds)
      .gte("timestamp_at", monthStart.toISOString())
      .lte("timestamp_at", monthEnd.toISOString());

    // Contar miembros únicos que asistieron
    const attendedSet = new Set<string>();
    const attendanceByMember = new Map<string, number>();

    attendance?.forEach((a) => {
      if (a.event_type === "check_in") {
        attendedSet.add(a.member_id);
        attendanceByMember.set(a.member_id, (attendanceByMember.get(a.member_id) ?? 0) + 1);
      }
    });

    const report = members
      .map((member) => ({
        id: member.id,
        name: member.full_name,
        attended: attendedSet.has(member.id),
        sessions: attendanceByMember.get(member.id) ?? 0,
      }))
      .sort((a, b) => b.sessions - a.sessions);

    return {
      totalMembers: members.length,
      activeMembers: attendedSet.size,
      attendedThisMonth: attendedSet.size,
      data: report,
    };
  },
});

// ---------------------------------------------------------------------------
// INSCRIPCIÓN PÚBLICA
// ---------------------------------------------------------------------------

/** Inscribe un nuevo miembro en un programa de gimnasio. */
export const enrollGymMemberFn = createServerFn({
  method: "POST",
  async handler(input: {
    programId: string;
    fullName: string;
    phone?: string;
    email?: string;
    referralCode?: string;
  }) {
    const db = getSupabaseAdmin();

    // Validar programa
    const { data: program, error: programError } = await db
      .from("loyalty_programs")
      .select("*")
      .eq("id", input.programId)
      .single();

    if (programError || !program) throw new Error("Programa no encontrado");

    // Crear miembro
    const { data: member, error: memberError } = await db
      .from("loyalty_members")
      .insert({
        program_id: input.programId,
        full_name: input.fullName.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
      })
      .select()
      .single();

    if (memberError || !member) throw new Error("Error al crear miembro");

    // Obtener configuración del programa para crear membresía
    const { data: config } = await db
      .from("gym_program_config")
      .select("*")
      .eq("program_id", input.programId)
      .single();

    // Crear membresía por defecto (monthly)
    const expiresAt = new Date();
    if (config) {
      expiresAt.setDate(expiresAt.getDate() + config.monthly_days);
    } else {
      expiresAt.setDate(expiresAt.getDate() + 30);
    }

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

    if (membershipError || !membership) throw new Error("Error al crear membresía");

    // Si hay código de referido, activarlo
    if (input.referralCode) {
      const { data: referral } = await db
        .from("gym_referrals")
        .select("*")
        .eq("referral_code", input.referralCode)
        .eq("status", "pending")
        .single();

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
  },
});

/** Obtiene datos para la página de inscripción por referral code. */
export const getReferralInscriptionDataFn = createServerFn({
  method: "POST",
  async handler(input: { referralCode: string }) {
    const db = getSupabaseAdmin();

    const { data: referral, error: refError } = await db
      .from("gym_referrals")
      .select("*, gym_referrals!referrer_id(loyalty_members!program_id)")
      .eq("referral_code", input.referralCode)
      .eq("status", "pending")
      .single();

    if (refError || !referral) throw new Error("Código de referido inválido o ya canjeado");

    // Obtener datos del referrer (quien invitó)
    const { data: referrer } = await db
      .from("loyalty_members")
      .select("*, loyalty_programs!program_id(*), loyalty_businesses!business_id(*)")
      .eq("id", referral.referrer_id)
      .single();

    if (!referrer) throw new Error("Referidor no encontrado");

    return {
      referral,
      referrer,
      programId: referrer.program_id,
    };
  },
});


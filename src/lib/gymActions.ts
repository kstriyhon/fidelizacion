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

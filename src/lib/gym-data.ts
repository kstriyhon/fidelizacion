// Tipos y funciones de datos para el módulo de gimnasios.
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Tipos del dominio
// ---------------------------------------------------------------------------

export type Membership = {
  id: string;
  member_id: string;
  membership_type: "monthly" | "quarterly" | "annual";
  started_at: string;
  expires_at: string;
  payment_status: "up_to_date" | "overdue" | "paused";
  amount_paid: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Attendance = {
  id: string;
  member_id: string;
  timestamp_at: string;
  event_type: "check_in" | "check_out";
  duration_minutes: number | null;
  entry_method: "qr" | "manual" | "auto";
  created_at: string;
};

export type AttendanceSession = {
  date: string;
  check_in: string | null; // ISO timestamp
  check_out: string | null;
  duration_minutes: number | null;
};

export type Referral = {
  id: string;
  referrer_id: string;
  referree_id: string | null;
  referral_code: string;
  reward_type: "discount" | "stamps" | "free_days";
  reward_value: number;
  status: "pending" | "activated" | "claimed";
  activated_at: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GymProgramConfig = {
  id: string;
  program_id: string;
  monthly_days: number;
  quarterly_days: number;
  annual_days: number;
  monthly_price: number | null;
  quarterly_price: number | null;
  annual_price: number | null;
  notify_days: number;
  auto_checkin: boolean;
  auto_checkout_minutes: number;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Funciones de consulta
// ---------------------------------------------------------------------------

export async function getMembershipByMemberId(memberId: string): Promise<Membership | null> {
  const client = createClient();
  const { data } = await client
    .from("gym_memberships")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return data ?? null;
}

export async function getMembershipsByProgramId(
  programId: string,
): Promise<(Membership & { member_id: string })[]> {
  const client = createClient();
  const { data } = await client
    .from("gym_memberships")
    .select("gym_memberships.*, loyalty_members.program_id")
    .join("loyalty_members", "gym_memberships.member_id", "loyalty_members.id")
    .eq("loyalty_members.program_id", programId);

  return data ?? [];
}

/** Obtiene las últimas N asistencias de un miembro, agrupadas por día. */
export async function getRecentAttendance(
  memberId: string,
  days: number = 30,
): Promise<AttendanceSession[]> {
  const client = createClient();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data } = await client
    .from("gym_attendance")
    .select("timestamp_at, event_type")
    .eq("member_id", memberId)
    .gte("timestamp_at", startDate.toISOString())
    .order("timestamp_at", { ascending: true });

  if (!data) return [];

  // Agrupar por día y emparejar check_in/check_out
  const sessionsByDate = new Map<string, AttendanceSession>();

  for (const record of data) {
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

  return Array.from(sessionsByDate.values()).sort((a, b) =>
    b.date.localeCompare(a.date),
  );
}

/** Obtiene todas las asistencias de un miembro en un período. */
export async function getAttendanceRecords(
  memberId: string,
  startDate: Date,
  endDate: Date,
): Promise<Attendance[]> {
  const client = createClient();
  const { data } = await client
    .from("gym_attendance")
    .select("*")
    .eq("member_id", memberId)
    .gte("timestamp_at", startDate.toISOString())
    .lte("timestamp_at", endDate.toISOString())
    .order("timestamp_at", { ascending: false });

  return data ?? [];
}

/** Obtiene referrals creados por un miembro. */
export async function getReferralsByReferrer(memberId: string): Promise<Referral[]> {
  const client = createClient();
  const { data } = await client
    .from("gym_referrals")
    .select("*")
    .eq("referrer_id", memberId)
    .order("created_at", { ascending: false });

  return data ?? [];
}

/** Obtiene un referral por código (para validar al registrarse). */
export async function getReferralByCode(code: string): Promise<Referral | null> {
  const client = createClient();
  const { data } = await client
    .from("gym_referrals")
    .select("*")
    .eq("referral_code", code)
    .single();

  return data ?? null;
}

/** Obtiene la configuración del programa de gimnasio. */
export async function getGymProgramConfig(programId: string): Promise<GymProgramConfig | null> {
  const client = createClient();
  const { data } = await client
    .from("gym_program_config")
    .select("*")
    .eq("program_id", programId)
    .single();

  return data ?? null;
}

// ---------------------------------------------------------------------------
// Funciones de mutación (Server-only)
// ---------------------------------------------------------------------------

export async function createMembership(
  memberId: string,
  type: "monthly" | "quarterly" | "annual",
  programId: string,
): Promise<Membership | null> {
  const client = createClient();
  const config = await getGymProgramConfig(programId);
  if (!config) return null;

  const daysMap = {
    monthly: config.monthly_days,
    quarterly: config.quarterly_days,
    annual: config.annual_days,
  };

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + daysMap[type]);

  const { data } = await client
    .from("gym_memberships")
    .insert({
      member_id: memberId,
      membership_type: type,
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  return data ?? null;
}

export async function checkInMember(memberId: string): Promise<Attendance | null> {
  const client = createClient();
  const { data } = await client
    .from("gym_attendance")
    .insert({
      member_id: memberId,
      timestamp_at: new Date().toISOString(),
      event_type: "check_in",
      entry_method: "manual",
    })
    .select()
    .single();

  return data ?? null;
}

export async function checkOutMember(memberId: string): Promise<Attendance | null> {
  const client = createClient();

  // Buscar el último check_in sin check_out
  const { data: lastCheckIn } = await client
    .from("gym_attendance")
    .select("id, timestamp_at")
    .eq("member_id", memberId)
    .eq("event_type", "check_in")
    .order("timestamp_at", { ascending: false })
    .limit(1)
    .single();

  if (!lastCheckIn) return null;

  const checkInTime = new Date(lastCheckIn.timestamp_at).getTime();
  const checkOutTime = Date.now();
  const durationMinutes = Math.round((checkOutTime - checkInTime) / 60000);

  const { data } = await client
    .from("gym_attendance")
    .insert({
      member_id: memberId,
      timestamp_at: new Date().toISOString(),
      event_type: "check_out",
      duration_minutes: durationMinutes,
      entry_method: "manual",
    })
    .select()
    .single();

  return data ?? null;
}

export async function createReferral(
  referrerId: string,
  rewardType: "discount" | "stamps" | "free_days" = "discount",
  rewardValue: number = 10,
): Promise<Referral | null> {
  const client = createClient();

  // Generar código único (ej. REF-ABC123DEF)
  const code = `REF-${Math.random().toString(36).substring(2, 8).toUpperCase()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  const { data } = await client
    .from("gym_referrals")
    .insert({
      referrer_id: referrerId,
      referral_code: code,
      reward_type: rewardType,
      reward_value: rewardValue,
      status: "pending",
    })
    .select()
    .single();

  return data ?? null;
}

export async function activateReferral(
  referralCode: string,
  referreeId: string,
): Promise<Referral | null> {
  const client = createClient();
  const { data } = await client
    .from("gym_referrals")
    .update({
      referree_id: referreeId,
      status: "activated",
      activated_at: new Date().toISOString(),
    })
    .eq("referral_code", referralCode)
    .select()
    .single();

  return data ?? null;
}

export async function claimReferralReward(referralId: string): Promise<Referral | null> {
  const client = createClient();
  const { data } = await client
    .from("gym_referrals")
    .update({
      status: "claimed",
      claimed_at: new Date().toISOString(),
    })
    .eq("id", referralId)
    .select()
    .single();

  return data ?? null;
}

export async function updateMembershipStatus(
  membershipId: string,
  status: "up_to_date" | "overdue" | "paused",
): Promise<Membership | null> {
  const client = createClient();
  const { data } = await client
    .from("gym_memberships")
    .update({
      payment_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", membershipId)
    .select()
    .single();

  return data ?? null;
}

export async function initializeGymProgramConfig(
  programId: string,
): Promise<GymProgramConfig | null> {
  const client = createClient();
  const { data } = await client
    .from("gym_program_config")
    .insert({
      program_id: programId,
      monthly_days: 30,
      quarterly_days: 90,
      annual_days: 365,
      notify_days: 7,
      auto_checkin: false,
      auto_checkout_minutes: 180,
    })
    .select()
    .single();

  return data ?? null;
}

// Métricas y análisis de asistencia para el módulo de gimnasios.
import type { AttendanceSession, Membership } from "@/lib/gym-data";

const DAY = 86_400_000; // milliseconds

// ---------------------------------------------------------------------------
// Análisis de membresía
// ---------------------------------------------------------------------------

/** Verifica si una membresía está activa (no vencida). */
export function isMembershipActive(membership: Membership, now = Date.now()): boolean {
  return now < new Date(membership.expires_at).getTime();
}

/** Días restantes para que venza la membresía (negativo si ya venció). */
export function daysUntilExpiration(membership: Membership, now = Date.now()): number {
  const expiresTime = new Date(membership.expires_at).getTime();
  return Math.ceil((expiresTime - now) / DAY);
}

/** Verifica si vence dentro de N días. */
export function membershipExpiringWithin(
  membership: Membership,
  days: number,
  now = Date.now(),
): boolean {
  const daysLeft = daysUntilExpiration(membership, now);
  return daysLeft > 0 && daysLeft <= days;
}

/** Porcentaje de vigencia de la membresía (0-100%). */
export function membershipProgressPercent(membership: Membership, now = Date.now()): number {
  const startTime = new Date(membership.started_at).getTime();
  const expiresTime = new Date(membership.expires_at).getTime();
  const elapsed = now - startTime;
  const total = expiresTime - startTime;
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
}

// ---------------------------------------------------------------------------
// Análisis de asistencia
// ---------------------------------------------------------------------------

export type AttendanceMetrics = {
  total_sessions: number;
  last_attendance: string | null; // ISO date
  days_since_last: number | null;
  streak_current: number; // sesiones consecutivas (sin más de 2 días de gap)
  streak_max: number; // mejor racha histórica
  avg_duration_minutes: number | null;
  sessions_this_week: number;
  sessions_this_month: number;
  frequency_per_week: number; // promedio general
  is_active: boolean; // ha asistido en los últimos 7 días
  is_dormant: boolean; // no ha asistido en más de 30 días
};

/**
 * Calcula métricas de asistencia a partir del historial.
 * Las "sesiones" se cuentan por día con check-in (independientemente de check-out).
 */
export function computeAttendanceMetrics(
  sessions: AttendanceSession[],
  opts?: { now?: Date; dormantDays?: number },
): AttendanceMetrics {
  const now = opts?.now ?? new Date();
  const dormantDays = opts?.dormantDays ?? 30;

  if (sessions.length === 0) {
    return {
      total_sessions: 0,
      last_attendance: null,
      days_since_last: null,
      streak_current: 0,
      streak_max: 0,
      avg_duration_minutes: null,
      sessions_this_week: 0,
      sessions_this_month: 0,
      frequency_per_week: 0,
      is_active: false,
      is_dormant: false,
    };
  }

  // Ordenar por fecha (más nuevo primero)
  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date));

  // Última asistencia
  const lastAttendance = sorted[0].date;
  const lastDate = new Date(lastAttendance);
  const daysSinceLast = Math.floor((now.getTime() - lastDate.getTime()) / DAY);

  // Sesiones esta semana y este mes
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(now);
  monthAgo.setDate(monthAgo.getDate() - 30);

  const sessionsThisWeek = sorted.filter((s) => new Date(s.date) > weekAgo).length;
  const sessionsThisMonth = sorted.filter((s) => new Date(s.date) > monthAgo).length;

  // Promedio de sesiones por semana (en toda la historia)
  const oldestDate = new Date(sorted[sorted.length - 1].date);
  const weeksSpan = (now.getTime() - oldestDate.getTime()) / (DAY * 7);
  const frequencyPerWeek = weeksSpan > 0 ? sorted.length / weeksSpan : 0;

  // Rachas (sesiones consecutivas sin gap > 2 días)
  let currentStreak = 0;
  let maxStreak = 0;
  let lastSessionDate: Date | null = null;

  for (let i = sorted.length - 1; i >= 0; i--) {
    const sessionDate = new Date(sorted[i].date);
    if (!lastSessionDate) {
      currentStreak = 1;
      lastSessionDate = sessionDate;
    } else {
      const gapDays = (lastSessionDate.getTime() - sessionDate.getTime()) / DAY;
      if (gapDays <= 2) {
        currentStreak++;
      } else {
        maxStreak = Math.max(maxStreak, currentStreak);
        currentStreak = 1;
      }
      lastSessionDate = sessionDate;
    }
  }
  maxStreak = Math.max(maxStreak, currentStreak);

  // Duración promedio
  const durationsWithData = sorted.filter((s) => s.duration_minutes !== null);
  const avgDuration =
    durationsWithData.length > 0
      ? durationsWithData.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0) /
        durationsWithData.length
      : null;

  return {
    total_sessions: sorted.length,
    last_attendance: lastAttendance,
    days_since_last: daysSinceLast,
    streak_current: currentStreak,
    streak_max: maxStreak,
    avg_duration_minutes: avgDuration ? Math.round(avgDuration) : null,
    sessions_this_week: sessionsThisWeek,
    sessions_this_month: sessionsThisMonth,
    frequency_per_week: Math.round(frequencyPerWeek * 10) / 10,
    is_active: daysSinceLast <= 7,
    is_dormant: daysSinceLast > dormantDays,
  };
}

// ---------------------------------------------------------------------------
// Análisis de referidos
// ---------------------------------------------------------------------------

export type ReferralMetrics = {
  pending: number; // códigos aún no canjeados
  activated: number; // referidos que se registraron
  claimed: number; // recompensas entregadas
  total_reward_value: number; // suma de recompensas disponibles/entregadas
};

export function computeReferralMetrics(referrals: Array<{
  status: "pending" | "activated" | "claimed";
  reward_value: number;
}>): ReferralMetrics {
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

  return {
    pending,
    activated,
    claimed,
    total_reward_value: totalReward,
  };
}

// ---------------------------------------------------------------------------
// Análisis de gymio completo (por programa)
// ---------------------------------------------------------------------------

export type GymAnalytics = {
  memberships: {
    total: number;
    active: number;
    expiring_soon: number; // en los próximos 7 días
    overdue: number;
  };
  attendance: {
    avg_sessions_per_member_week: number;
    active_members: number; // asistieron en últimos 7 días
    dormant_members: number; // no asistieron en 30 días
    total_unique_attendees: number;
  };
  referrals: {
    pending_codes: number;
    activated: number;
    potential_reward_value: number;
  };
};

/**
 * Calcula analítica general del gimnasio a partir de todos sus miembros.
 */
export function computeGymAnalytics(opts: {
  memberships: Membership[];
  attendanceByMember: Map<string, AttendanceSession[]>;
  referralsByMember: Map<string, Array<{ status: string; reward_value: number }>>;
  now?: Date;
}): GymAnalytics {
  const now = opts.now ?? new Date();
  const memberships = opts.memberships;
  const attendanceByMember = opts.attendanceByMember;
  const referralsByMember = opts.referralsByMember;

  // Analítica de membresías
  let activeMemberships = 0;
  let expiringMemberships = 0;
  let overdueMemberships = 0;

  for (const m of memberships) {
    if (isMembershipActive(m, now.getTime())) {
      activeMemberships++;
      if (membershipExpiringWithin(m, 7, now.getTime())) expiringMemberships++;
    } else {
      overdueMemberships++;
    }
  }

  // Analítica de asistencia
  let totalSessionsAllMembers = 0;
  let activeMembers = 0;
  let dormantMembers = 0;
  const uniqueAttendees = new Set<string>();

  for (const [memberId, sessions] of attendanceByMember) {
    if (sessions.length > 0) {
      uniqueAttendees.add(memberId);
      totalSessionsAllMembers += sessions.length;

      const metrics = computeAttendanceMetrics(sessions, { now });
      if (metrics.is_active) activeMembers++;
      if (metrics.is_dormant) dormantMembers++;
    }
  }

  const weeksToAnalyze = 52; // promedio anual
  const avgSessionsPerWeek =
    uniqueAttendees.size > 0 ? totalSessionsAllMembers / weeksToAnalyze / uniqueAttendees.size : 0;

  // Analítica de referidos
  let pendingReferrals = 0;
  let activatedReferrals = 0;
  let totalRewardValue = 0;

  for (const referrals of referralsByMember.values()) {
    for (const ref of referrals) {
      if (ref.status === "pending") pendingReferrals++;
      if (ref.status === "activated") activatedReferrals++;
      totalRewardValue += ref.reward_value;
    }
  }

  return {
    memberships: {
      total: memberships.length,
      active: activeMemberships,
      expiring_soon: expiringMemberships,
      overdue: overdueMemberships,
    },
    attendance: {
      avg_sessions_per_member_week: Math.round(avgSessionsPerWeek * 10) / 10,
      active_members: activeMembers,
      dormant_members: dormantMembers,
      total_unique_attendees: uniqueAttendees.size,
    },
    referrals: {
      pending_codes: pendingReferrals,
      activated: activatedReferrals,
      potential_reward_value: totalRewardValue,
    },
  };
}

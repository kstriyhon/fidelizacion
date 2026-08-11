// Tipos del dominio del módulo de gimnasios.
//
// Este archivo es SOLO TIPOS: todo el acceso a datos del gimnasio vive en
// `gymActions.ts` (server functions con el cliente service_role). Antes había
// aquí ~15 helpers que llamaban a un `createClient()` inexistente en
// `@/lib/supabase` (que exporta `supabase`, no `createClient`) — código muerto
// que además habría usado el cliente anon, saltándose la autorización de Fase 2.

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

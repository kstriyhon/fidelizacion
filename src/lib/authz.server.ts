// Autorización para las server functions — SOLO SERVIDOR.
// Regla: una acción sobre un negocio la puede hacer su DUEÑO (owner_id) o un ADMIN.
import { getSupabaseAdmin, getUserFromToken } from "./supabaseAdmin.server";
import { isAdminEmail } from "./admins";

export type AuthUser = { id: string; email: string | null };

/** Exige sesión válida. Lanza si no hay usuario. */
export async function requireUser(token: string | undefined): Promise<AuthUser> {
  const user = await getUserFromToken(token);
  if (!user) throw new Error("No autorizado: inicia sesión.");
  return user;
}

/** Exige que el usuario sea administrador. */
export async function requireAdmin(token: string | undefined): Promise<AuthUser> {
  const user = await requireUser(token);
  if (!isAdminEmail(user.email)) throw new Error("No autorizado: se requiere administrador.");
  return user;
}

/** Exige que el usuario sea dueño del negocio indicado, o admin. */
export async function requireBusinessAccess(
  token: string | undefined,
  businessId: string,
): Promise<{ user: AuthUser; isAdmin: boolean }> {
  const user = await requireUser(token);
  if (isAdminEmail(user.email)) return { user, isAdmin: true };

  const admin = getSupabaseAdmin();
  const { data: biz } = await admin
    .from("loyalty_businesses")
    .select("owner_id")
    .eq("id", businessId)
    .maybeSingle();
  if (!biz || biz.owner_id !== user.id) {
    throw new Error("No autorizado: no eres dueño de este negocio.");
  }
  return { user, isAdmin: false };
}

/** Igual que requireBusinessAccess pero resolviendo el negocio desde un programa. */
export async function requireProgramAccess(
  token: string | undefined,
  programId: string,
): Promise<{ user: AuthUser; isAdmin: boolean; businessId: string }> {
  const admin = getSupabaseAdmin();
  const { data: prog } = await admin
    .from("loyalty_programs")
    .select("business_id")
    .eq("id", programId)
    .maybeSingle();
  if (!prog) throw new Error("Programa no encontrado.");
  const res = await requireBusinessAccess(token, prog.business_id as string);
  return { ...res, businessId: prog.business_id as string };
}

/** Igual, resolviendo desde un miembro (para dar sello/canjear/mensaje). */
export async function requireMemberAccess(
  token: string | undefined,
  memberId: string,
): Promise<{ user: AuthUser; isAdmin: boolean }> {
  const admin = getSupabaseAdmin();
  const { data: mem } = await admin
    .from("loyalty_members")
    .select("program_id")
    .eq("id", memberId)
    .maybeSingle();
  if (!mem) throw new Error("Cliente no encontrado.");
  return requireProgramAccess(token, mem.program_id as string).then(({ user, isAdmin }) => ({
    user,
    isAdmin,
  }));
}

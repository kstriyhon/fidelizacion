// Autorización para las server functions — SOLO SERVIDOR.
// Regla: una acción sobre un negocio la puede hacer su DUEÑO (owner_id) o un ADMIN.
import { getSupabaseAdmin, getUserFromToken } from "./supabaseAdmin.server";
import { isAdminEmail } from "./admins";
import { looksLikeBusinessToken, verifyBusinessToken } from "./businessSession.server";

export type AuthUser = { id: string; email: string | null };

/** Exige sesión válida. Lanza si no hay usuario. */
export async function requireUser(token: string | undefined): Promise<AuthUser> {
  const user = await getUserFromToken(token);
  if (!user) throw new Error("No autorizado: inicia sesión.");
  return user;
}

/**
 * Exige que el usuario sea administrador.
 *
 * Una sesión de negocio NUNCA vale aquí, y se rechaza de forma explícita en
 * lugar de confiar en que getUserFromToken falle por su cuenta: dejar que el
 * rechazo dependa de un efecto colateral es justo el tipo de suposición que se
 * rompe en silencio cuando alguien cambia algo más adelante.
 */
export async function requireAdmin(token: string | undefined): Promise<AuthUser> {
  if (looksLikeBusinessToken(token)) {
    throw new Error("No autorizado: se requiere administrador.");
  }
  const user = await requireUser(token);
  if (!isAdminEmail(user.email)) throw new Error("No autorizado: se requiere administrador.");
  return user;
}

/**
 * Resuelve el businessId de una sesión de negocio (/p/{slug}), o null si el
 * token no es de ese tipo. Lanza si tiene la forma pero no es válido —
 * manipulado o caducado — para que el cliente vea "vuelve a entrar" en lugar de
 * caer por el camino de Supabase con un error confuso.
 */
export async function businessIdFromSession(token: string | undefined): Promise<string | null> {
  if (!looksLikeBusinessToken(token)) return null;
  const businessId = await verifyBusinessToken(token);
  if (!businessId) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
  return businessId;
}

export type Access = {
  /** null cuando se entró con sesión de negocio: ahí no hay usuario de Supabase. */
  user: AuthUser | null;
  isAdmin: boolean;
  /** true si se entró por /p/{slug} en vez de con cuenta de Supabase. */
  viaBusinessSession: boolean;
};

/**
 * Exige acceso al negocio indicado. Lo concede de dos formas:
 *  - sesión de negocio (/p/{slug}), y SOLO para su propio negocio;
 *  - cuenta de Supabase, siendo dueño del negocio o admin.
 *
 * Es el único punto por el que pasan requireProgramAccess y requireMemberAccess,
 * así que habilitar aquí la sesión de negocio habilita de paso dar sellos,
 * canjear premios y mandar mensajes, sin tocar esas 13 llamadas una a una.
 */
export async function requireBusinessAccess(
  token: string | undefined,
  businessId: string,
): Promise<Access> {
  // La comprobación que sostiene todo: el token va firmado con UN businessId
  // dentro, así que un cliente no puede pedir el panel de otro comercio
  // cambiando el id — tendría que falsificar la firma.
  const sessionBusinessId = await businessIdFromSession(token);
  if (sessionBusinessId) {
    if (sessionBusinessId !== businessId) {
      throw new Error("No autorizado: esta sesión no pertenece a ese negocio.");
    }
    return { user: null, isAdmin: false, viaBusinessSession: true };
  }

  const user = await requireUser(token);
  if (isAdminEmail(user.email)) return { user, isAdmin: true, viaBusinessSession: false };

  const admin = getSupabaseAdmin();
  const { data: biz } = await admin
    .from("loyalty_businesses")
    .select("owner_id")
    .eq("id", businessId)
    .maybeSingle();
  if (!biz || biz.owner_id !== user.id) {
    throw new Error("No autorizado: no eres dueño de este negocio.");
  }
  return { user, isAdmin: false, viaBusinessSession: false };
}

/** Igual que requireBusinessAccess pero resolviendo el negocio desde un programa. */
export async function requireProgramAccess(
  token: string | undefined,
  programId: string,
): Promise<Access & { businessId: string }> {
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

/**
 * Como requireProgramAccess, pero RECHAZA la sesión de negocio: exige cuenta de
 * Supabase (dueño o admin).
 *
 * Para lo que define el trato comercial —cuántos sellos, qué premio— o toca la
 * infraestructura de Wallet. El comercio gestiona su día a día (sellos, canjes,
 * mensajes), pero no se cambia a sí mismo las condiciones del programa.
 *
 * Ocultar el botón en la UI no basta: las server functions se pueden llamar
 * directamente, así que el corte tiene que estar aquí.
 */
export async function requireProgramOwner(
  token: string | undefined,
  programId: string,
): Promise<Access & { businessId: string }> {
  const res = await requireProgramAccess(token, programId);
  if (res.viaBusinessSession) {
    throw new Error("No autorizado: esto solo lo puede cambiar quien administra la plataforma.");
  }
  return res;
}

/** Igual, resolviendo desde un miembro (para dar sello/canjear/mensaje). */
export async function requireMemberAccess(
  token: string | undefined,
  memberId: string,
): Promise<Access> {
  const admin = getSupabaseAdmin();
  const { data: mem } = await admin
    .from("loyalty_members")
    .select("program_id")
    .eq("id", memberId)
    .maybeSingle();
  if (!mem) throw new Error("Cliente no encontrado.");
  const { user, isAdmin, viaBusinessSession } = await requireProgramAccess(
    token,
    mem.program_id as string,
  );
  return { user, isAdmin, viaBusinessSession };
}

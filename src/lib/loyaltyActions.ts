// Server functions: puente entre la UI, Supabase y Google Wallet.
// FASE 2 (seguridad): usan el cliente service_role (omite RLS) y AUTORIZAN cada
// acción (dueño del negocio o admin) verificando el access_token del usuario.
// La inscripción pública (enroll) no requiere sesión.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Business, Member, Program } from "./data";
import { getSupabaseAdmin } from "./supabaseAdmin.server";
import {
  requireUser,
  requireAdmin,
  requireBusinessAccess,
  requireProgramAccess,
  requireMemberAccess,
} from "./authz.server";
import {
  createMemberPass,
  ensureProgramClass,
  pushStampUpdate,
  pushMessage,
  patchLoyaltyObject,
} from "./wallet/google.server";
import {
  createMemberApplePass,
  pushAppleStampUpdate,
  pushAppleMessage,
  broadcastApple,
} from "./wallet/apple.server";
import { getAppleWalletConfig } from "./wallet/apple-config.server";
import {
  notifyStampUpdate,
  notifyPersonalMessage,
  notifyBroadcast,
} from "./wallet/apns.server";

async function loadMemberContext(memberId: string): Promise<{
  member: Member;
  program: Program;
  business: Business;
}> {
  const db = getSupabaseAdmin();
  const { data: member, error: e1 } = await db
    .from("loyalty_members")
    .select("*")
    .eq("id", memberId)
    .single();
  if (e1 || !member) throw new Error(`Cliente no encontrado: ${e1?.message ?? memberId}`);

  const { data: program, error: e2 } = await db
    .from("loyalty_programs")
    .select("*")
    .eq("id", member.program_id)
    .single();
  if (e2 || !program) throw new Error(`Programa no encontrado: ${e2?.message ?? ""}`);

  const { data: business, error: e3 } = await db
    .from("loyalty_businesses")
    .select("*")
    .eq("id", program.business_id)
    .single();
  if (e3 || !business) throw new Error(`Comercio no encontrado: ${e3?.message ?? ""}`);
  assertActive(business as Business);

  return { member: member as Member, program: program as Program, business: business as Business };
}

/** Lanza si el servicio del comercio está pausado (bloquea sellos/inscripción). */
function assertActive(business: Business) {
  if (business.status === "paused") {
    throw new Error("Servicio pausado. Contacta al administrador para reactivarlo.");
  }
}

// ===========================================================================
// LECTURA
// ===========================================================================

/** Panel del comercio: datos del negocio del usuario autenticado. */
export const getMyDashboardFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser(data.token);
    const db = getSupabaseAdmin();
    const { data: business } = await db
      .from("loyalty_businesses")
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (!business) return { business: null, program: null, members: [] as Member[] };

    const { data: program } = await db
      .from("loyalty_programs")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    let members: Member[] = [];
    if (program) {
      const { data: mem } = await db
        .from("loyalty_members")
        .select("*")
        .eq("program_id", program.id)
        .order("enrolled_at", { ascending: false });
      members = (mem as Member[]) ?? [];
    }
    return {
      business: business as Business,
      program: (program as Program) ?? null,
      members,
    };
  });

/** Admin: todos los negocios, programas y clientes. */
export const adminListFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const db = getSupabaseAdmin();
    const [{ data: businesses }, { data: programs }, { data: members }] = await Promise.all([
      db.from("loyalty_businesses").select("*").order("created_at"),
      db.from("loyalty_programs").select("*"),
      db.from("loyalty_members").select("*"),
    ]);
    return {
      businesses: (businesses as Business[]) ?? [],
      programs: (programs as Program[]) ?? [],
      members: (members as Member[]) ?? [],
    };
  });

/** Admin: un negocio concreto (para gestionar sus tarjetas). */
export const adminGetBusinessFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), businessId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const db = getSupabaseAdmin();
    const { data: business } = await db
      .from("loyalty_businesses")
      .select("*")
      .eq("id", data.businessId)
      .maybeSingle();
    if (!business) return { business: null, program: null, members: [] as Member[] };
    const { data: program } = await db
      .from("loyalty_programs")
      .select("*")
      .eq("business_id", data.businessId)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    let members: Member[] = [];
    if (program) {
      const { data: mem } = await db
        .from("loyalty_members")
        .select("*")
        .eq("program_id", program.id)
        .order("enrolled_at", { ascending: false });
      members = (mem as Member[]) ?? [];
    }
    return {
      business: business as Business,
      program: (program as Program) ?? null,
      members,
    };
  });

// ===========================================================================
// ADMINISTRACIÓN EMPRESARIAL (SaaS) — solo admin
// ===========================================================================

/** Edita los datos de gestión de una empresa (nombre, contacto, email, pagos). */
export const adminUpdateBusinessFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      businessId: z.string().uuid(),
      name: z.string().trim().min(2),
      contact_phone: z.string().trim().max(30).nullable(),
      email: z.string().trim().email().nullable().or(z.literal("")),
      payment_status: z.enum(["up_to_date", "overdue"]),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const db = getSupabaseAdmin();
    const { error } = await db
      .from("loyalty_businesses")
      .update({
        name: data.name,
        contact_phone: data.contact_phone || null,
        email: data.email || null,
        payment_status: data.payment_status,
      })
      .eq("id", data.businessId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Pausa o reactiva el servicio de una empresa. */
export const adminSetBusinessStatusFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      businessId: z.string().uuid(),
      status: z.enum(["active", "paused"]),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const db = getSupabaseAdmin();
    const { error } = await db
      .from("loyalty_businesses")
      .update({ status: data.status })
      .eq("id", data.businessId);
    if (error) throw new Error(error.message);
    return { ok: true, status: data.status };
  });

/** Elimina una empresa y todos sus datos (programas, clientes, historial). */
export const adminDeleteBusinessFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), businessId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const db = getSupabaseAdmin();
    // El on delete cascade de las FK borra programas, clientes y eventos.
    const { error } = await db.from("loyalty_businesses").delete().eq("id", data.businessId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ===========================================================================
// ESCRITURA — gestión (dueño o admin)
// ===========================================================================

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

/** Crea un negocio + su primer programa. El dueño es el usuario autenticado. */
export const createBusinessFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      name: z.string().trim().min(2),
      brand_color: z.string().trim().min(4).max(9),
      programName: z.string().trim().min(1),
      stamps_required: z.number().int().min(1).max(30),
      reward_description: z.string().trim().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser(data.token);
    const db = getSupabaseAdmin();

    const slug = `${slugify(data.name)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: biz, error: be } = await db
      .from("loyalty_businesses")
      .insert({ name: data.name, slug, brand_color: data.brand_color, owner_id: user.id })
      .select("*")
      .single();
    if (be || !biz) throw new Error(`No se pudo crear el comercio: ${be?.message ?? ""}`);

    const { data: prog, error: pe } = await db
      .from("loyalty_programs")
      .insert({
        business_id: biz.id,
        name: data.programName,
        stamps_required: data.stamps_required,
        reward_description: data.reward_description,
      })
      .select("*")
      .single();
    if (pe || !prog) throw new Error(`No se pudo crear el programa: ${pe?.message ?? ""}`);

    try {
      const res = await ensureProgramClass(prog as Program, biz as Business);
      await db.from("loyalty_programs").update({ wallet_class_id: res.classId }).eq("id", prog.id);
    } catch (err) {
      console.warn("provision class:", err);
    }
    return { business: biz as Business };
  });

/** Sube/actualiza el logo del negocio (dueño o admin) y re-aprovisiona la tarjeta. */
export const uploadLogoFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      businessId: z.string().uuid(),
      contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
      dataBase64: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    await requireBusinessAccess(data.token, data.businessId);
    const db = getSupabaseAdmin();

    const ext =
      data.contentType === "image/png"
        ? "png"
        : data.contentType === "image/webp"
          ? "webp"
          : "jpg";
    const bytes = Uint8Array.from(atob(data.dataBase64), (c) => c.charCodeAt(0));
    if (bytes.length > 5 * 1024 * 1024) throw new Error("La imagen supera 5MB.");

    const path = `${data.businessId}-${Date.now()}.${ext}`;
    const { error: upErr } = await db.storage
      .from("logos")
      .upload(path, bytes, { contentType: data.contentType, upsert: true });
    if (upErr) throw new Error(`No se pudo subir el logo: ${upErr.message}`);

    const { data: pub } = db.storage.from("logos").getPublicUrl(path);
    const logo_url = pub.publicUrl;

    const { error: updErr } = await db
      .from("loyalty_businesses")
      .update({ logo_url })
      .eq("id", data.businessId);
    if (updErr) throw new Error(updErr.message);

    // Re-aprovisiona la LoyaltyClass para que el logo aparezca en el pase.
    try {
      const { data: business } = await db
        .from("loyalty_businesses")
        .select("*")
        .eq("id", data.businessId)
        .single();
      const { data: program } = await db
        .from("loyalty_programs")
        .select("*")
        .eq("business_id", data.businessId)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (business && program) {
        await ensureProgramClass(program as Program, business as Business);
      }
    } catch (err) {
      console.warn("re-provision tras logo:", err);
    }

    return { logo_url };
  });

/** Guarda la ubicación del negocio (alertas de proximidad) y re-aprovisiona la tarjeta. */
export const setBusinessLocationFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      businessId: z.string().uuid(),
      latitude: z.number().min(-90).max(90).nullable(),
      longitude: z.number().min(-180).max(180).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    await requireBusinessAccess(data.token, data.businessId);
    const db = getSupabaseAdmin();
    const { error } = await db
      .from("loyalty_businesses")
      .update({ latitude: data.latitude, longitude: data.longitude })
      .eq("id", data.businessId);
    if (error) throw new Error(error.message);

    // Re-aprovisiona la LoyaltyClass para que la ubicación llegue al pase.
    try {
      const { data: business } = await db
        .from("loyalty_businesses")
        .select("*")
        .eq("id", data.businessId)
        .single();
      const { data: program } = await db
        .from("loyalty_programs")
        .select("*")
        .eq("business_id", data.businessId)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (business && program) {
        await ensureProgramClass(program as Program, business as Business);
      }
    } catch (err) {
      console.warn("re-provision tras ubicación:", err);
    }
    return { ok: true };
  });

/** Edita el mensaje personalizado del sello. */
export const updateStampMessageFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      programId: z.string().uuid(),
      stamp_message: z.string().max(300).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    await requireProgramAccess(data.token, data.programId);
    const db = getSupabaseAdmin();
    const value = (data.stamp_message ?? "").trim();
    const { error } = await db
      .from("loyalty_programs")
      .update({ stamp_message: value || null })
      .eq("id", data.programId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Edita el programa de sellos (nombre, sellos requeridos, premio) y re-aprovisiona. */
export const updateProgramFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      programId: z.string().uuid(),
      name: z.string().trim().min(1).max(60),
      stamps_required: z.number().int().min(1).max(30),
      reward_description: z.string().trim().min(1).max(120),
    }),
  )
  .handler(async ({ data }) => {
    const { businessId } = await requireProgramAccess(data.token, data.programId);
    const db = getSupabaseAdmin();
    const { error } = await db
      .from("loyalty_programs")
      .update({
        name: data.name,
        stamps_required: data.stamps_required,
        reward_description: data.reward_description,
      })
      .eq("id", data.programId);
    if (error) throw new Error(error.message);

    // Re-aprovisiona la clase para reflejar el nuevo nombre/premio en el pase.
    try {
      const { data: business } = await db
        .from("loyalty_businesses")
        .select("*")
        .eq("id", businessId)
        .single();
      const { data: program } = await db
        .from("loyalty_programs")
        .select("*")
        .eq("id", data.programId)
        .single();
      if (business && program) await ensureProgramClass(program as Program, business as Business);
    } catch (err) {
      console.warn("re-provision tras editar programa:", err);
    }
    return { ok: true };
  });

/** Edita el mensaje de bienvenida (al inscribirse). */
export const updateWelcomeMessageFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      programId: z.string().uuid(),
      welcome_message: z.string().max(300).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    await requireProgramAccess(data.token, data.programId);
    const db = getSupabaseAdmin();
    const value = (data.welcome_message ?? "").trim();
    const { error } = await db
      .from("loyalty_programs")
      .update({ welcome_message: value || null })
      .eq("id", data.programId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** (Re)aprovisiona la LoyaltyClass del programa en Google Wallet. */
export const provisionProgramFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), programId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireProgramAccess(data.token, data.programId);
    const db = getSupabaseAdmin();
    const { data: program, error: pe } = await db
      .from("loyalty_programs")
      .select("*")
      .eq("id", data.programId)
      .single();
    if (pe || !program) throw new Error(`Programa no encontrado: ${pe?.message ?? ""}`);
    const { data: business, error: be } = await db
      .from("loyalty_businesses")
      .select("*")
      .eq("id", program.business_id)
      .single();
    if (be || !business) throw new Error(`Comercio no encontrado: ${be?.message ?? ""}`);

    const res = await ensureProgramClass(program as Program, business as Business);
    await db.from("loyalty_programs").update({ wallet_class_id: res.classId }).eq("id", program.id);
    return res;
  });

/** Suma un sello (dueño o admin). */
export const addStampFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), memberId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireMemberAccess(data.token, data.memberId);
    const db = getSupabaseAdmin();
    const { member, program, business } = await loadMemberContext(data.memberId);

    const newStamps = Math.min(member.stamps + 1, program.stamps_required);
    const completed = newStamps >= program.stamps_required;

    const { data: updated, error } = await db
      .from("loyalty_members")
      .update({ stamps: newStamps, last_stamp_at: new Date().toISOString() })
      .eq("id", member.id)
      .select("*")
      .single();
    if (error || !updated) throw new Error(`No se pudo sellar: ${error?.message ?? ""}`);

    await db.from("loyalty_stamp_events").insert({
      member_id: member.id,
      delta: newStamps - member.stamps,
      kind: "stamp",
    });

    const faltan = program.stamps_required - newStamps;
    const message = completed
      ? {
          header: `¡Tarjeta completa! 🎉`,
          body: `Ya puedes reclamar: ${program.reward_description} en ${business.name}.`,
        }
      : {
          header: `¡Nuevo sello! ✅`,
          body: program.stamp_message
            ? program.stamp_message
                .replace(/\{negocio\}/g, business.name)
                .replace(/\{nombre\}/g, member.full_name)
                .replace(/\{sellos\}/g, String(newStamps))
                .replace(/\{total\}/g, String(program.stamps_required))
                .replace(/\{faltan\}/g, String(faltan))
                .replace(/\{premio\}/g, program.reward_description)
            : `Vas ${newStamps}/${program.stamps_required} en ${business.name}. Te ${
                faltan === 1 ? "falta" : "faltan"
              } ${faltan} para tu premio.`,
        };
    const push = await pushStampUpdate(
      { id: member.id, full_name: member.full_name, stamps: newStamps },
      program,
      message,
    );

    return { member: updated as Member, completed, push };
  });

/** Canjea el premio (dueño o admin). */
export const redeemRewardFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), memberId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireMemberAccess(data.token, data.memberId);
    const db = getSupabaseAdmin();
    const { member, program, business } = await loadMemberContext(data.memberId);
    if (member.stamps < program.stamps_required) {
      throw new Error("La tarjeta aún no está completa.");
    }

    const { data: updated, error } = await db
      .from("loyalty_members")
      .update({ stamps: 0, rewards_redeemed: member.rewards_redeemed + 1 })
      .eq("id", member.id)
      .select("*")
      .single();
    if (error || !updated) throw new Error(`No se pudo canjear: ${error?.message ?? ""}`);

    await db.from("loyalty_stamp_events").insert({
      member_id: member.id,
      delta: -program.stamps_required,
      kind: "redeem",
      note: program.reward_description,
    });

    const push = await pushStampUpdate(
      { id: member.id, full_name: member.full_name, stamps: 0 },
      program,
      {
        header: "Premio canjeado ✅",
        body: `¡Gracias por tu visita a ${business.name}! Empieza una nueva tarjeta.`,
      },
    );
    return { member: updated as Member, push };
  });

/** Edita la información de un cliente (dueño o admin). */
export const updateMemberFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      memberId: z.string().uuid(),
      full_name: z.string().trim().min(2).max(80),
      phone: z.string().trim().max(30).nullable(),
      email: z.string().trim().email().nullable().or(z.literal("")),
    }),
  )
  .handler(async ({ data }) => {
    await requireMemberAccess(data.token, data.memberId);
    const db = getSupabaseAdmin();
    const { data: updated, error } = await db
      .from("loyalty_members")
      .update({
        full_name: data.full_name,
        phone: data.phone || null,
        email: data.email || null,
      })
      .eq("id", data.memberId)
      .select("*")
      .single();
    if (error || !updated) throw new Error(`No se pudo actualizar: ${error?.message ?? ""}`);

    // Actualiza el nombre en el pase (best-effort).
    try {
      await patchLoyaltyObject(data.memberId, { accountName: data.full_name });
    } catch (err) {
      console.warn("patch member name:", err);
    }
    return { member: updated as Member };
  });

/** Elimina la tarjeta de un cliente (dueño o admin) y expira su pase de Google. */
export const deleteMemberFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), memberId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireMemberAccess(data.token, data.memberId);
    // Expira el pase para que desaparezca del teléfono del cliente (best-effort).
    try {
      await patchLoyaltyObject(data.memberId, { state: "EXPIRED" });
    } catch (err) {
      console.warn("expire member object:", err);
    }
    const db = getSupabaseAdmin();
    const { error } = await db.from("loyalty_members").delete().eq("id", data.memberId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Mensaje puntual a un cliente (dueño o admin). */
export const sendMemberMessageFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      memberId: z.string().uuid(),
      title: z.string().trim().min(1).max(60),
      body: z.string().trim().min(1).max(300),
    }),
  )
  .handler(async ({ data }) => {
    await requireMemberAccess(data.token, data.memberId);
    const { member, business } = await loadMemberContext(data.memberId);
    const vars: Record<string, string> = { nombre: member.full_name, negocio: business.name };
    const fill = (s: string) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    const push = await pushMessage(member.id, {
      header: fill(data.title),
      body: fill(data.body),
    });
    return { push };
  });

/** Aviso a TODOS los clientes de un programa (dueño o admin). Object-level. */
export const broadcastFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      programId: z.string().uuid(),
      title: z.string().trim().min(1).max(60),
      body: z.string().trim().min(1).max(300),
    }),
  )
  .handler(async ({ data }) => {
    await requireProgramAccess(data.token, data.programId);
    const db = getSupabaseAdmin();
    const { data: prog } = await db
      .from("loyalty_programs")
      .select("business_id, loyalty_businesses(name, status)")
      .eq("id", data.programId)
      .single();
    const biz = (prog as { loyalty_businesses?: { name?: string; status?: string } } | null)
      ?.loyalty_businesses;
    if (biz?.status === "paused") {
      throw new Error("Servicio pausado. Contacta al administrador para reactivarlo.");
    }
    const businessName = biz?.name ?? "";

    const { data: members, error: me } = await db
      .from("loyalty_members")
      .select("id, full_name")
      .eq("program_id", data.programId);
    if (me) throw new Error(`No se pudieron cargar los clientes: ${me.message}`);

    const list = (members ?? []) as { id: string; full_name: string }[];
    const fill = (s: string, name: string) =>
      s.replace(/\{negocio\}/g, businessName).replace(/\{nombre\}/g, name);

    const results = await Promise.allSettled(
      list.map((m) =>
        pushMessage(m.id, {
          header: fill(data.title, m.full_name),
          body: fill(data.body, m.full_name),
        }),
      ),
    );
    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<{ sent: boolean; mock: boolean }> => r.status === "fulfilled",
    );
    const sent = fulfilled.filter((r) => r.value.sent).length;
    const failed = results.length - fulfilled.length;
    const mock = fulfilled.length > 0 && fulfilled.every((r) => r.value.mock);
    return { total: list.length, sent, failed, mock };
  });

// ===========================================================================
// ESCRITURA — pública (inscripción de clientes)
// ===========================================================================

/** Inscribe un cliente a un programa y le genera el pase. Público (sin sesión). */
export const enrollMemberFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      programId: z.string().uuid(),
      full_name: z.string().min(2),
      phone: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
    }),
  )
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();
    const { data: program, error: pe } = await db
      .from("loyalty_programs")
      .select("*")
      .eq("id", data.programId)
      .eq("active", true)
      .single();
    if (pe || !program) throw new Error(`Programa no encontrado o inactivo: ${pe?.message ?? ""}`);

    const { data: business, error: be } = await db
      .from("loyalty_businesses")
      .select("*")
      .eq("id", program.business_id)
      .single();
    if (be || !business) throw new Error(`Comercio no encontrado: ${be?.message ?? ""}`);
    if ((business as Business).status === "paused") {
      throw new Error("Este comercio no está disponible por el momento.");
    }

    const { data: member, error: me } = await db
      .from("loyalty_members")
      .insert({
        program_id: data.programId,
        full_name: data.full_name,
        phone: data.phone || null,
        email: data.email || null,
        stamps: 0,
      })
      .select("*")
      .single();
    if (me || !member) throw new Error(`No se pudo inscribir: ${me?.message ?? ""}`);

    const pass = await createMemberPass(
      { id: member.id, full_name: member.full_name, stamps: member.stamps },
      program as Program,
      business as Business,
    );

    await db.from("loyalty_members").update({ wallet_object_id: pass.objectId }).eq("id", member.id);

    // Pase de Apple Wallet (best-effort: si falla, no bloquea la inscripción —
    // el cliente igual queda registrado y puede usar Google Wallet).
    let appleDownloadUrl: string | null = null;
    let appleMock = true;
    let appleSerialNumber: string | null = null;
    try {
      const appleCfg = getAppleWalletConfig();
      const applePass = await createMemberApplePass(
        { id: member.id, full_name: member.full_name, stamps: member.stamps },
        program as Program,
        business as Business,
      );
      const { error: appleInsertError } = await db.from("loyalty_apple_passes").insert({
        member_id: member.id,
        pass_type_id: appleCfg.passTypeId,
        serial_number: applePass.serialNumber,
        auth_token: applePass.authToken,
        // El .pkpass completo (ZIP firmado) se guarda acá para poder
        // servirlo desde /api/passkit/download/:serial. En modo mock no hay
        // pase real, se guarda vacío solo para trackear el intento.
        // PostgREST espera bytea como texto hex "\x..." — pasar un Buffer
        // directo se serializa mal (queda como JSON {"type":"Buffer",...}).
        signature: "\\x" + (applePass.pkpassBuffer ?? Buffer.from("")).toString("hex"),
      });
      if (appleInsertError) throw new Error(appleInsertError.message);

      await db
        .from("loyalty_members")
        .update({ apple_pass_serial_number: applePass.serialNumber })
        .eq("id", member.id);

      appleDownloadUrl = applePass.downloadUrl;
      appleMock = applePass.mock;
      appleSerialNumber = applePass.serialNumber;
    } catch (err) {
      console.warn("apple pass creation:", err);
    }

    // Mensaje de bienvenida en el pase (aparece al agregar la tarjeta).
    try {
      const tpl =
        (program as Program).welcome_message ||
        "¡Bienvenido/a, {nombre}! Gracias por unirte a {negocio}. Junta sellos y gana premios.";
      const body = tpl
        .replace(/\{nombre\}/g, member.full_name)
        .replace(/\{negocio\}/g, (business as Business).name);
      await pushMessage(member.id, { header: `¡Bienvenido/a a ${(business as Business).name}! 🎉`, body });
    } catch (err) {
      console.warn("welcome message:", err);
    }

    return {
      member: {
        ...(member as Member),
        wallet_object_id: pass.objectId,
        apple_pass_serial_number: appleSerialNumber,
      },
      saveUrl: pass.saveUrl,
      mock: pass.mock,
      appleDownloadUrl,
      appleMock,
    };
  });

/** Agrega un sello y notifica al cliente via Apple Wallet + APNs. */
export const addAppleStampFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      memberId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser(data.token);
    await requireMemberAccess(data.token, data.memberId);

    const db = getSupabaseAdmin();
    const { member, program, business } = await loadMemberContext(data.memberId);

    // Sumar sello
    const newStamps = member.stamps + 1;
    const completed = newStamps >= program.stamps_required;

    const { error: updateError } = await db
      .from("loyalty_members")
      .update({ stamps: completed ? 0 : newStamps, rewards_redeemed: completed ? (member.rewards_redeemed || 0) + 1 : member.rewards_redeemed })
      .eq("id", member.id);

    if (updateError) throw new Error(`No se pudo sumar sello: ${updateError.message}`);

    // Registrar evento
    await db.from("loyalty_stamp_events").insert({
      member_id: member.id,
      delta: 1,
      kind: "stamp",
      note: completed ? "Completó tarjeta" : null,
    });

    // Notificar via Apple (APNs)
    const { data: devices } = await db
      .from("loyalty_device_registrations")
      .select("push_token")
      .eq("member_id", member.id);

    if (devices && devices.length > 0) {
      const pushTokens = devices.map((d) => d.push_token);
      const alert = completed
        ? `¡Felicidades! Completaste la tarjeta de ${business.name} 🎉`
        : `¡Nuevo sello! ${newStamps}/${program.stamps_required} en ${business.name}`;

      await notifyStampUpdate(member.apple_pass_serial_number || "", newStamps, program.stamps_required, business.name, pushTokens);
    }

    return {
      member: {
        ...member,
        stamps: completed ? 0 : newStamps,
        rewards_redeemed: completed ? (member.rewards_redeemed || 0) + 1 : member.rewards_redeemed,
      },
      completed,
    };
  });

/** Envía un mensaje personalizado a un cliente via Apple Wallet. */
export const sendAppleMemberMessageFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      memberId: z.string().uuid(),
      title: z.string(),
      body: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    await requireMemberAccess(data.token, data.memberId);

    const db = getSupabaseAdmin();
    const { member, business } = await loadMemberContext(data.memberId);

    // Obtener dispositivos registrados
    const { data: devices } = await db
      .from("loyalty_device_registrations")
      .select("push_token")
      .eq("member_id", member.id);

    if (!devices || devices.length === 0) {
      return { sent: 0, mock: true };
    }

    const pushTokens = devices.map((d) => d.push_token);
    const result = await notifyPersonalMessage(business.name, data.title, data.body, pushTokens);

    return result;
  });

/** Envía un mensaje de broadcast a todos los clientes de un programa via Apple. */
export const broadcastAppleFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      programId: z.string().uuid(),
      title: z.string(),
      body: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    await requireProgramAccess(data.token, data.programId);

    const db = getSupabaseAdmin();

    // Obtener programa y negocio
    const { data: program } = await db.from("loyalty_programs").select("*").eq("id", data.programId).single();

    if (!program) throw new Error("Programa no encontrado");

    const { data: business } = await db
      .from("loyalty_businesses")
      .select("*")
      .eq("id", (program as Program).business_id)
      .single();

    // Obtener todos los dispositivos de clientes del programa
    const { data: members } = await db
      .from("loyalty_members")
      .select("id")
      .eq("program_id", data.programId);

    if (!members || members.length === 0) {
      return { sent: 0, failed: 0, mock: true };
    }

    // Obtener todos los tokens de estos clientes
    const { data: deviceRegs } = await db
      .from("loyalty_device_registrations")
      .select("push_token")
      .in(
        "member_id",
        members.map((m) => m.id),
      );

    if (!deviceRegs || deviceRegs.length === 0) {
      return { sent: 0, failed: 0, mock: true };
    }

    const pushTokens = deviceRegs.map((d) => d.push_token);
    const result = await notifyBroadcast((business as Business).name, data.body, pushTokens);

    return result;
  });

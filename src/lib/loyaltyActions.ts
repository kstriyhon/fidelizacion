// Server functions: puente entre la UI, Supabase y Google Wallet.
// FASE 2 (seguridad): usan el cliente service_role (omite RLS) y AUTORIZAN cada
// acción (dueño del negocio o admin) verificando el access_token del usuario.
// La inscripción pública (enroll) no requiere sesión.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Business, Member, Program, ProgramWithWallet, Plan, Subscription, Invoice } from "./data";
import { PROGRAM_CLIENT_COLUMNS } from "./data";
import { getSupabaseAdmin } from "./supabaseAdmin.server";
import {
  requireUser,
  requireAdmin,
  requireBusinessAccess,
  requireProgramAccess,
  requireProgramOwner,
  requireMemberAccess,
  businessIdFromSession,
} from "./authz.server";
import { isAdminEmail } from "./admins";
import { hashPassword, verifyPassword, dummyVerify } from "./password.server";
import { signBusinessToken } from "./businessSession.server";
import {
  createMemberPass,
  ensureProgramClass,
  pushStampUpdate,
  pushMessage,
  patchLoyaltyObject,
} from "./wallet/google.server";
import { getWalletConfigForProgram } from "./wallet/config.server";
import { createMemberApplePass, regenerateApplePassBuffer } from "./wallet/apple.server";
import { getAppleWalletConfig } from "./wallet/apple-config.server";
import { notifyMemberPassUpdate } from "./wallet/apns.server";

/**
 * Refirma el pase de Apple de un cliente (si tiene uno) con datos frescos y
 * empuja el push de actualización a sus dispositivos registrados. Best-effort:
 * si el cliente no tiene pase de Apple, está en modo mock, o algo falla, no
 * bloquea la operación principal (dar sello / canjear / mandar mensaje) —
 * Google Wallet ya se actualizó igual.
 */
async function syncApplePass(
  member: { id: string; full_name: string; stamps: number; apple_pass_serial_number: string | null },
  program: Program,
  business: Business,
  opts?: { stampChangeMessage?: string; auxiliaryMessage?: string },
): Promise<void> {
  if (!member.apple_pass_serial_number) return;
  const serialNumber = member.apple_pass_serial_number;

  try {
    const db = getSupabaseAdmin();
    const appleCfg = getAppleWalletConfig();

    // El authenticationToken del pase regenerado debe ser EXACTAMENTE el
    // mismo que ya tiene el pase instalado en el dispositivo — si cambiara,
    // Wallet ya no podría autenticarse contra nuestro web service.
    const { data: existingPass } = await db
      .from("loyalty_apple_passes")
      .select("auth_token")
      .eq("pass_type_id", appleCfg.passTypeId)
      .eq("serial_number", serialNumber)
      .single();
    if (!existingPass?.auth_token) return;

    const { pkpassBuffer, mock } = await regenerateApplePassBuffer(
      member,
      program,
      business,
      serialNumber,
      existingPass.auth_token,
      opts,
    );
    if (mock || !pkpassBuffer) return;

    await db
      .from("loyalty_apple_passes")
      .update({ signature: "\\x" + pkpassBuffer.toString("hex"), updated_at: new Date().toISOString() })
      .eq("pass_type_id", appleCfg.passTypeId)
      .eq("serial_number", serialNumber);

    const { data: devices } = await db
      .from("loyalty_device_registrations")
      .select("push_token")
      .eq("member_id", member.id);
    const tokens = (devices ?? []).map((d) => d.push_token as string).filter(Boolean);
    if (tokens.length > 0) {
      await notifyMemberPassUpdate(tokens);
    }
  } catch (err) {
    console.warn("syncApplePass:", err);
  }
}

async function loadMemberContext(memberId: string): Promise<{
  member: Member;
  // ProgramWithWallet y no Program: aqui se carga con select("*"), asi que
  // trae las credenciales de Wallet que getWalletConfigForProgram necesita.
  program: ProgramWithWallet;
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

  return {
    member: member as Member,
    program: program as ProgramWithWallet,
    business: business as Business,
  };
}

/**
 * Google solo entrega 3 notificaciones por tarjeta cada 24 h. A partir de ahí
 * NO las rechaza: las encola, y llegan horas después todas juntas. Además avisa
 * de que puede recortar la cuota del emisor si considera que abusa.
 *
 * Así que a partir de la tercera se manda el mensaje sin pedir notificación:
 * aparece igual en la tarjeta, al momento, y no se gasta cuota.
 *
 * Se cuenta sobre loyalty_stamp_events, que registra sellos y canjes — la vía
 * automática y la única que puede dispararse muchas veces en un día. Los
 * mensajes que el comercio escribe a mano no quedan ahí y no se cuentan: son
 * deliberados y poco frecuentes, así que no compensa añadir una tabla solo para
 * eso. Si algún día se vuelven habituales, habría que registrarlos también.
 */
const LIMITE_NOTIFICACIONES_24H = 3;

async function puedeNotificar(
  db: ReturnType<typeof getSupabaseAdmin>,
  memberId: string,
): Promise<boolean> {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await db
    .from("loyalty_stamp_events")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId)
    .in("kind", ["stamp", "redeem"])
    .gte("created_at", desde);

  // Ante la duda, notificar: perder un aviso es peor que gastar una cuota.
  if (error) {
    console.warn("puedeNotificar: no se pudo contar, se notifica igualmente:", error.message);
    return true;
  }
  return (count ?? 0) < LIMITE_NOTIFICACIONES_24H;
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

/** Entrada del selector de negocios del panel. */
export type SwitchableBusiness = { id: string; name: string };

/** Plan del negocio y consumo actual, para el bloque de plan del panel. */
export type PlanUsage = {
  planName: string;
  priceCop: number;
  members: number;
  maxMembers: number;
  programs: number;
  maxPrograms: number;
};

/**
 * Plan contratado y cuánto se lleva consumido.
 *
 * Hasta ahora no había forma de ver esto desde la aplicación: había que
 * consultar la base. Con el alta self-service eso no se sostiene — alguien
 * elige Empresarial, paga, y no tiene dónde comprobar que está donde cree.
 */
async function loadPlanUsage(
  db: ReturnType<typeof getSupabaseAdmin>,
  businessId: string,
  programs: Program[],
): Promise<PlanUsage | null> {
  const { data: sub } = await db
    .from("loyalty_subscriptions")
    .select("plan:loyalty_plans(name,price_cop,max_members,max_programs)")
    .eq("business_id", businessId)
    .eq("status", "active")
    .maybeSingle();

  const plan = sub?.plan as unknown as Plan | undefined;
  if (!plan) return null;

  let members = 0;
  if (programs.length > 0) {
    const { count } = await db
      .from("loyalty_members")
      .select("id", { count: "exact", head: true })
      .in("program_id", programs.map((p) => p.id));
    members = count ?? 0;
  }

  return {
    planName: plan.name,
    priceCop: plan.price_cop,
    members,
    maxMembers: plan.max_members,
    programs: programs.length,
    maxPrograms: plan.max_programs,
  };
}

/**
 * Arma la respuesta del panel a partir del negocio ya resuelto Y AUTORIZADO.
 *
 * Ojo: esta función NO comprueba permisos. Da por hecho que quien la llama ya
 * decidió que ese negocio se puede ver. Existe para que los dos caminos de
 * entrada — sesión de negocio y cuenta de Supabase — devuelvan exactamente la
 * misma forma de datos sin duplicar la consulta.
 */
async function buildDashboard(
  db: ReturnType<typeof getSupabaseAdmin>,
  business: { id: string } | null,
  switchable: SwitchableBusiness[] = [],
): Promise<{
  business: Business | null;
  programs: Program[];
  members: Member[];
  switchable: SwitchableBusiness[];
  planUsage: PlanUsage | null;
}> {
  if (!business) {
    return { business: null, programs: [], members: [], switchable, planUsage: null };
  }

  // Sin "*": esto se devuelve al navegador. El cliente service_role se salta
  // cualquier permiso de columna de la base, así que aquí la lista explícita es
  // lo único que impide que las credenciales de Wallet salgan de servidor.
  const { data: programs } = await db
    .from("loyalty_programs")
    .select(PROGRAM_CLIENT_COLUMNS)
    .eq("business_id", business.id)
    .order("created_at");

  let members: Member[] = [];
  if (programs && programs.length > 0) {
    const programIds = programs.map((p) => p.id);
    const { data: mem } = await db
      .from("loyalty_members")
      .select("*")
      .in("program_id", programIds)
      .order("enrolled_at", { ascending: false });
    members = (mem as Member[]) ?? [];
  }

  const lista = (programs as Program[]) ?? [];
  return {
    business: business as Business,
    programs: lista,
    members,
    switchable,
    planUsage: await loadPlanUsage(db, business.id, lista),
  };
}

/**
 * Negocios entre los que ESTA sesión puede cambiar, para el selector del panel.
 *
 * Se devuelve junto con el panel en vez de en una llamada aparte: es la misma
 * petición que ya se hace al cargar, y así el selector no parpadea llegando
 * tarde. Solo id y nombre — no hace falta más para pintar un desplegable, y
 * cuanto menos viaje, mejor.
 */
async function listSwitchableBusinesses(
  db: ReturnType<typeof getSupabaseAdmin>,
  user: { id: string; email: string | null },
): Promise<SwitchableBusiness[]> {
  const base = db.from("loyalty_businesses").select("id,name").order("name");
  // Un admin gestiona toda la plataforma; el resto, solo lo suyo. El filtro por
  // owner_id es lo que impide que el desplegable liste negocios ajenos.
  const { data } = isAdminEmail(user.email) ? await base : await base.eq("owner_id", user.id);
  return (data as SwitchableBusiness[]) ?? [];
}

/** Un movimiento del historial de un cliente. */
export type StampEvent = {
  id: string;
  delta: number;
  kind: "stamp" | "redeem" | "adjust";
  note: string | null;
  created_at: string;
};

/**
 * Historial de sellos y canjes de UN cliente, el más reciente primero.
 *
 * Se pide por cliente y bajo demanda (al desplegar su fila) en vez de venir con
 * el panel: con decenas de clientes y varios sellos cada uno, cargarlo todo de
 * golpe sería mandar al navegador un montón de datos que casi nunca se miran.
 *
 * requireMemberAccess ata la consulta al negocio dueño del cliente, así que un
 * comercio no puede leer el historial de los clientes de otro.
 */
export const getMemberHistoryFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), memberId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireMemberAccess(data.token, data.memberId);
    const db = getSupabaseAdmin();
    const { data: events, error } = await db
      .from("loyalty_stamp_events")
      .select("id,delta,kind,note,created_at")
      .eq("member_id", data.memberId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (events as StampEvent[]) ?? [];
  });

/**
 * Datos de una reserva y su pase, a partir del enlace que el hotel manda al
 * huésped. PÚBLICA, igual que la inscripción por QR: el huésped no tiene cuenta.
 *
 * Lo que la protege es que el access_token es aleatorio y no el código de
 * reserva — los hoteles los numeran de forma correlativa, y con el código en la
 * URL cualquiera podría recorrerlos y leer las reservas de los demás.
 *
 * Emite el pase la primera vez y lo ACTUALIZA si ya existe: cuando el huésped
 * vuelve, el hotel crea otra reserva y esta función reescribe su tarjeta de
 * siempre en vez de emitirle una segunda.
 */
export const getReservationByTokenFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().min(8) }))
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();

    const { data: reserva } = await db
      .from("hotel_reservations")
      .select("*")
      .eq("access_token", data.token)
      .maybeSingle();
    if (!reserva) throw new Error("Esta reserva no existe o el enlace caducó.");

    const { data: member } = await db
      .from("loyalty_members")
      // Sin la cédula a propósito: esta respuesta va al navegador del huésped.
      .select("id, full_name, stamps, program_id, wallet_object_id")
      .eq("id", reserva.member_id)
      .maybeSingle();
    if (!member) throw new Error("No encontramos al huésped de esta reserva.");

    const { data: program } = await db
      .from("loyalty_programs")
      .select("*")
      .eq("id", member.program_id)
      .maybeSingle();
    if (!program) throw new Error("Programa no encontrado.");

    const { data: business } = await db
      .from("loyalty_businesses")
      .select("*")
      .eq("id", program.business_id)
      .maybeSingle();
    if (!business) throw new Error("Hotel no encontrado.");

    const { data: settings } = await db
      .from("hotel_settings")
      .select("*")
      .eq("business_id", business.id)
      .maybeSingle();

    const hotel = {
      reservation: reserva as never,
      settings: (settings ?? {
        services: [],
        guest_guide: [],
        reception_phone: null,
        whatsapp: null,
        website: null,
      }) as never,
    };

    const cfg = getWalletConfigForProgram(program as ProgramWithWallet);
    const pass = await createMemberPass(
      { id: member.id, full_name: member.full_name, stamps: member.stamps ?? 0 },
      program as Program,
      business as Business,
      cfg,
      { tipo: program.tipo ?? "hotel", hotel },
    );

    if (pass.objectId && pass.objectId !== member.wallet_object_id) {
      await db.from("loyalty_members").update({ wallet_object_id: pass.objectId }).eq("id", member.id);
    }

    return {
      hotelName: business.name as string,
      brandColor: business.brand_color as string,
      logoUrl: (business.logo_url as string | null) ?? null,
      guestName: member.full_name as string,
      reservation: {
        code: reserva.reservation_code as string,
        room: (reserva.room as string | null) ?? null,
        guests: reserva.guests as number,
        checkIn: reserva.check_in as string,
        checkOut: reserva.check_out as string,
        status: reserva.status as string,
      },
      googleSaveUrl: pass.saveUrl,
      googleMock: pass.mock,
    };
  });

/** Panel del comercio: datos del negocio del usuario autenticado. */
export const getMyDashboardFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), businessId: z.string().uuid().optional() }))
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();

    let business;

    // Sesión de negocio (/p/{slug}): el negocio sale del token FIRMADO y se
    // ignora a propósito cualquier businessId que mande el cliente. Si se
    // respetara el de la petición, un comercio podría pedir el panel de otro
    // cambiando un parámetro, que es justo lo que se cerró esta mañana.
    const sessionBusinessId = await businessIdFromSession(data.token);
    if (sessionBusinessId) {
      const { data: b } = await db
        .from("loyalty_businesses")
        .select("*")
        .eq("id", sessionBusinessId)
        .maybeSingle();
      business = b;
      return await buildDashboard(db, business);
    }

    const user = await requireUser(data.token);
    if (data.businessId) {
      // El businessId llega desde la URL (?business=...), así que hay que exigir
      // ser DUEÑO del negocio, o admin.
      //
      // Antes aquí solo se comprobaba que el negocio TUVIERA credenciales
      // configuradas, sin atarlas nunca al usuario autenticado: se pedía el
      // token, se resolvía el usuario y luego no se comparaba con nada. Como el
      // registro en /login está abierto, cualquiera podía crearse una cuenta,
      // entrar a /comercio?business=<uuid ajeno> y recibir el panel completo de
      // otro comercio, con su lista de clientes y teléfonos.
      await requireBusinessAccess(data.token, data.businessId);

      const { data: b } = await db
        .from("loyalty_businesses")
        .select("*")
        .eq("id", data.businessId)
        .maybeSingle();
      business = b;
    } else {
      // Sino, devolver el negocio del usuario autenticado
      const { data: b } = await db
        .from("loyalty_businesses")
        .select("*")
        .eq("owner_id", user.id)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      business = b;
    }

    // Solo la sesión de Supabase llega aquí, así que solo el dueño (o el admin)
    // recibe la lista. Un cliente de /p/{slug} sale antes con switchable vacío:
    // tiene un único negocio y no debe ni enterarse de que existen otros.
    const switchable = await listSwitchableBusinesses(db, user);
    return await buildDashboard(db, business, switchable);
  });

/** Admin: todos los negocios, programas y clientes. */
export const adminListFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const db = getSupabaseAdmin();
    const [{ data: businesses }, { data: programs }, { data: members }] = await Promise.all([
      db.from("loyalty_businesses").select("*").order("created_at"),
      db.from("loyalty_programs").select(PROGRAM_CLIENT_COLUMNS),
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
    if (!business) return { business: null, programs: [] as Program[], members: [] as Member[] };

    const { data: programs } = await db
      .from("loyalty_programs")
      .select(PROGRAM_CLIENT_COLUMNS)
      .eq("business_id", data.businessId)
      .order("created_at");

    let members: Member[] = [];
    if (programs && programs.length > 0) {
      const programIds = programs.map((p) => p.id);
      const { data: mem } = await db
        .from("loyalty_members")
        .select("*")
        .in("program_id", programIds)
        .order("enrolled_at", { ascending: false });
      members = (mem as Member[]) ?? [];
    }

    return {
      business: business as Business,
      programs: (programs as Program[]) ?? [],
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
      /** Plan elegido en /planes. Si no viene, se usa el activo más barato. */
      planId: z.string().uuid().optional(),
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

    // Suscripción por defecto, al plan activo más barato.
    //
    // Sin esto el comercio nace SIN suscripción, y validatePlanLimits bloquea
    // la inscripción de clientes: su QR falla en el primer escaneo con "Negocio
    // no tiene suscripción activa" y nada avisa al administrador. Paso de
    // verdad — estuvo quince días bloqueando inscripciones sin que se notara.
    //
    // Best-effort: si algo falla aquí no se tira el alta del comercio, que ya
    // está creado. Se avisa en el log y se puede arreglar desde el panel.
    try {
      // El planId viene del cliente, así que se comprueba contra la BD en vez
      // de confiar en él: exigimos que exista y esté activo. Si no cuadra, se
      // cae al más barato en lugar de dejar el comercio sin suscripción.
      let plan: { id: string } | null = null;
      if (data.planId) {
        const { data: elegido } = await db
          .from("loyalty_plans")
          .select("id")
          .eq("id", data.planId)
          .eq("active", true)
          .maybeSingle();
        plan = elegido ?? null;
        if (!plan) {
          console.warn(`createBusinessFn: plan ${data.planId} no existe o no está activo.`);
        }
      }
      if (!plan) {
        const { data: barato } = await db
          .from("loyalty_plans")
          .select("id")
          .eq("active", true)
          .order("price_cop")
          .limit(1)
          .maybeSingle();
        plan = barato ?? null;
      }
      if (plan) {
        await db
          .from("loyalty_subscriptions")
          .insert({ business_id: biz.id, plan_id: plan.id, status: "active" });
      } else {
        console.warn(`createBusinessFn: no hay planes activos; ${biz.id} queda sin suscripción.`);
      }
    } catch (err) {
      console.warn(`createBusinessFn: no se pudo crear la suscripción de ${biz.id}:`, err);
    }

    try {
      const cfg = getWalletConfigForProgram(prog as ProgramWithWallet);
      const res = await ensureProgramClass(prog as Program, biz as Business, cfg);
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
        const cfg = getWalletConfigForProgram(program as ProgramWithWallet);
        await ensureProgramClass(program as Program, business as Business, cfg);
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
        const cfg = getWalletConfigForProgram(program as ProgramWithWallet);
        await ensureProgramClass(program as Program, business as Business, cfg);
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
    const { businessId } = await requireProgramOwner(data.token, data.programId);
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
      if (business && program) {
        const cfg = getWalletConfigForProgram(program as ProgramWithWallet);
        await ensureProgramClass(program as Program, business as Business, cfg);
      }
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

/** Actualiza las credenciales de acceso para un programa. Solo admin. */

/** (Re)aprovisiona la LoyaltyClass del programa en Google Wallet. */
export const provisionProgramFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), programId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireProgramOwner(data.token, data.programId);
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

    const cfg = getWalletConfigForProgram(program as ProgramWithWallet);
    const res = await ensureProgramClass(program as Program, business as Business, cfg);
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

    // Se consulta ANTES de registrar el sello de ahora: si se hiciera después,
    // este mismo evento entraría en la cuenta y el tercer sello del día —que sí
    // puede notificar— se quedaría sin aviso.
    const notificar = await puedeNotificar(db, member.id);

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
    const cfg = getWalletConfigForProgram(program);
    const push = await pushStampUpdate(
      { id: member.id, full_name: member.full_name, stamps: newStamps },
      program,
      message,
      cfg,
      notificar,
    );

    // Apple no tiene este límite: sus push van por APNs, que son nuestros.
    await syncApplePass(updated as Member, program, business, {
      stampChangeMessage: completed ? message.header : message.body,
    });

    return { member: updated as Member, completed, push, notificado: notificar };
  });

/**
 * Quita un sello dado por error (dueño, admin o el propio comercio).
 *
 * Queda registrado como 'adjust' con delta -1, no se borra el evento original:
 * el historial debe reflejar lo que pasó —se dio un sello y luego se quitó—,
 * no fingir que nunca ocurrió.
 *
 * La tarjeta del cliente se actualiza SIN mensaje: corregir un error nuestro no
 * justifica mandarle una notificación, y menos una de "¡Nuevo sello!".
 */
export const removeStampFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), memberId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireMemberAccess(data.token, data.memberId);
    const db = getSupabaseAdmin();
    const { member, program, business } = await loadMemberContext(data.memberId);

    if (member.stamps <= 0) {
      throw new Error("Este cliente no tiene sellos que quitar.");
    }

    const newStamps = member.stamps - 1;

    const { data: updated, error } = await db
      .from("loyalty_members")
      .update({ stamps: newStamps })
      .eq("id", member.id)
      .select("*")
      .single();
    if (error || !updated) throw new Error(`No se pudo quitar el sello: ${error?.message ?? ""}`);

    await db.from("loyalty_stamp_events").insert({
      member_id: member.id,
      delta: -1,
      kind: "adjust",
      note: "Sello quitado por el comercio",
    });

    // Sin el tercer argumento (message) solo se corrige el saldo del pase.
    const cfg = getWalletConfigForProgram(program);
    await pushStampUpdate(
      { id: member.id, full_name: member.full_name, stamps: newStamps },
      program,
      undefined,
      cfg,
    );

    await syncApplePass(updated as Member, program, business);

    return { member: updated as Member };
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

    const cfg = getWalletConfigForProgram(program);
    const push = await pushStampUpdate(
      { id: member.id, full_name: member.full_name, stamps: 0 },
      program,
      {
        header: "Premio canjeado ✅",
        body: `¡Gracias por tu visita a ${business.name}! Empieza una nueva tarjeta.`,
      },
    );

    await syncApplePass(updated as Member, program, business, {
      stampChangeMessage: "Premio canjeado ✅ ¡Gracias por tu visita!",
    });

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
      birth_month: z.number().int().min(1).max(12).nullable().optional(),
      birth_day: z.number().int().min(1).max(31).nullable().optional(),
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
        birth_month: data.birth_month ?? null,
        birth_day: data.birth_day ?? null,
      })
      .eq("id", data.memberId)
      .select("*")
      .single();
    if (error || !updated) throw new Error(`No se pudo actualizar: ${error?.message ?? ""}`);

    // Actualiza el nombre en el pase (best-effort).
    try {
      const { program } = await loadMemberContext(data.memberId);
      const cfg = getWalletConfigForProgram(program);
      await patchLoyaltyObject(data.memberId, { accountName: data.full_name }, cfg);
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
      const { program } = await loadMemberContext(data.memberId);
      const cfg = getWalletConfigForProgram(program);
      await patchLoyaltyObject(data.memberId, { state: "EXPIRED" }, cfg);
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
    const { member, program, business } = await loadMemberContext(data.memberId);
    const vars: Record<string, string> = { nombre: member.full_name, negocio: business.name };
    const fill = (s: string) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    const title = fill(data.title);
    const body = fill(data.body);
    const cfg = getWalletConfigForProgram(program);
    const push = await pushMessage(member.id, { header: title, body }, cfg);

    await syncApplePass(member, program, business, { auxiliaryMessage: `${title}: ${body}` });

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
      .select("*, loyalty_businesses(name, status)")
      .eq("id", data.programId)
      .single();
    const biz = (prog as (Program & { loyalty_businesses?: { name?: string; status?: string } }) | null)
      ?.loyalty_businesses;
    if (biz?.status === "paused") {
      throw new Error("Servicio pausado. Contacta al administrador para reactivarlo.");
    }
    const businessName = biz?.name ?? "";
    const business: Business = { ...(biz as Business), name: businessName };

    const { data: members, error: me } = await db
      .from("loyalty_members")
      .select("id, full_name, stamps, apple_pass_serial_number")
      .eq("program_id", data.programId);
    if (me) throw new Error(`No se pudieron cargar los clientes: ${me.message}`);

    const list = (members ?? []) as { id: string; full_name: string; stamps: number; apple_pass_serial_number: string | null }[];
    const fill = (s: string, name: string) =>
      s.replace(/\{negocio\}/g, businessName).replace(/\{nombre\}/g, name);

    const results = await Promise.allSettled(
      list.map(async (m) => {
        const title = fill(data.title, m.full_name);
        const body = fill(data.body, m.full_name);
        const cfg = prog ? getWalletConfigForProgram(prog as ProgramWithWallet) : undefined;
        const push = await pushMessage(m.id, { header: title, body }, cfg);
        if (prog) {
          await syncApplePass(m, prog as Program, business, { auxiliaryMessage: `${title}: ${body}` });
        }
        return push;
      }),
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
      birth_month: z.number().int().min(1).max(12).optional(),
      birth_day: z.number().int().min(1).max(31).optional(),
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

    // Validar límites del plan
    const validation = await validatePlanLimits((business as Business).id, "members");
    if (!validation.ok) throw new Error(validation.message);

    const { data: member, error: me } = await db
      .from("loyalty_members")
      .insert({
        program_id: data.programId,
        full_name: data.full_name,
        phone: data.phone || null,
        email: data.email || null,
        birth_month: data.birth_month || null,
        birth_day: data.birth_day || null,
        stamps: 0,
      })
      .select("*")
      .single();
    if (me || !member) throw new Error(`No se pudo inscribir: ${me?.message ?? ""}`);

    const cfg = getWalletConfigForProgram(program as ProgramWithWallet);
    const pass = await createMemberPass(
      { id: member.id, full_name: member.full_name, stamps: member.stamps },
      program as Program,
      business as Business,
      cfg,
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
      const cfg = getWalletConfigForProgram(program as ProgramWithWallet);
      await pushMessage(member.id, { header: `¡Bienvenido/a a ${(business as Business).name}! 🎉`, body }, cfg);
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

/** Crear nuevo programa de lealtad para un negocio */
export const createProgramFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      name: z.string().min(2),
      stamps_required: z.number().int().positive(),
      reward_description: z.string().min(2),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser(data.token);
    const db = getSupabaseAdmin();

    // Verificar que el usuario tiene un negocio
    const { data: business } = await db
      .from("loyalty_businesses")
      .select("*")
      .eq("owner_id", user.id)
      .single();
    if (!business) throw new Error("No tienes negocio");

    // Crear el programa
    const { data: program, error } = await db
      .from("loyalty_programs")
      .insert({
        business_id: business.id,
        name: data.name,
        stamps_required: data.stamps_required,
        reward_description: data.reward_description,
        active: true,
        wallet_class_id: `3388000000023178109.prog_${crypto.getRandomValues(new Uint8Array(16)).toString()}`,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return program as Program;
  });

// ===========================================================================
// SAAS - SUSCRIPCIONES Y FACTURACIÓN
// ===========================================================================

/** Obtener planes disponibles */
/**
 * Planes para la página pública de precios. SIN sesión, a diferencia de
 * listPlansFn: los precios son información comercial que queremos enseñar a
 * quien todavía no tiene cuenta.
 *
 * Devuelve solo lo que se pinta en la página. No usa select("*") para que, si
 * algún día se añade a loyalty_plans una columna interna (margen, notas,
 * condiciones), no salga sola a internet.
 */
export const listPublicPlansFn = createServerFn({ method: "POST" })
  .validator(z.object({}).optional())
  .handler(async () => {
    const db = getSupabaseAdmin();
    const { data: plans } = await db
      .from("loyalty_plans")
      .select("id,name,price_cop,max_programs,max_members,description")
      .eq("active", true)
      .order("price_cop", { ascending: true });
    return (plans as Plan[]) ?? [];
  });

export const listPlansFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    await requireUser(data.token);
    const db = getSupabaseAdmin();
    const { data: plans } = await db
      .from("loyalty_plans")
      .select("*")
      .eq("active", true)
      .order("price_cop", { ascending: true });
    return (plans as Plan[]) ?? [];
  });

/** Crear suscripción para un negocio (solo admin) */
export const createSubscriptionFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      businessId: z.string().uuid(),
      planId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const db = getSupabaseAdmin();

    // Cancelar suscripción anterior si existe
    const { data: existing } = await db
      .from("loyalty_subscriptions")
      .select("id")
      .eq("business_id", data.businessId)
      .eq("status", "active")
      .maybeSingle();

    if (existing) {
      await db
        .from("loyalty_subscriptions")
        .update({ status: "cancelled", ended_at: new Date().toISOString() })
        .eq("id", existing.id);
    }

    // Crear nueva suscripción
    const { data: sub, error } = await db
      .from("loyalty_subscriptions")
      .insert({
        business_id: data.businessId,
        plan_id: data.planId,
        status: "active",
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return sub as Subscription;
  });

/** Generar factura del mes actual */
export const generateMonthlyInvoiceFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), subscriptionId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const db = getSupabaseAdmin();

    const { data: sub } = await db
      .from("loyalty_subscriptions")
      .select("*, plan:loyalty_plans(*)")
      .eq("id", data.subscriptionId)
      .single();

    if (!sub) throw new Error("Suscripción no encontrada");

    const plan = sub.plan as unknown as Plan;
    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Verificar si ya existe factura para este mes
    const { data: existing } = await db
      .from("loyalty_invoices")
      .select("id")
      .eq("subscription_id", data.subscriptionId)
      .eq("month_year", monthYear)
      .maybeSingle();

    if (existing) throw new Error("Factura ya existe para este mes");

    // Crear factura
    const { data: invoice, error } = await db
      .from("loyalty_invoices")
      .insert({
        subscription_id: data.subscriptionId,
        business_id: sub.business_id,
        amount_cop: plan.price_cop,
        month_year: monthYear,
        status: "pending",
        due_date: new Date(now.getFullYear(), now.getMonth() + 1, 10).toISOString().split("T")[0],
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return invoice as Invoice;
  });

/** Marcar factura como pagada */
export const markInvoicePaidFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      invoiceId: z.string().uuid(),
      notes: z.string().max(500).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const db = getSupabaseAdmin();

    const { error } = await db
      .from("loyalty_invoices")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        notes: data.notes || null,
      })
      .eq("id", data.invoiceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Obtener suscripción y facturas de un negocio */
export const getSubscriptionDetailsFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), businessId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const db = getSupabaseAdmin();

    const { data: sub } = await db
      .from("loyalty_subscriptions")
      .select("*, plan:loyalty_plans(*)")
      .eq("business_id", data.businessId)
      .maybeSingle();

    if (!sub) return { subscription: null, invoices: [] };

    const { data: invoices } = await db
      .from("loyalty_invoices")
      .select("*")
      .eq("subscription_id", sub.id)
      .order("month_year", { ascending: false });

    return {
      subscription: sub as Subscription & { plan: Plan },
      invoices: (invoices as Invoice[]) ?? [],
    };
  });

/** Validar que el negocio no exceda los límites de su plan */
async function validatePlanLimits(
  businessId: string,
  resource: "programs" | "members",
): Promise<{ ok: boolean; message?: string }> {
  const db = getSupabaseAdmin();

  // Obtener suscripción y plan
  const { data: sub } = await db
    .from("loyalty_subscriptions")
    .select("*, plan:loyalty_plans(*)")
    .eq("business_id", businessId)
    .eq("status", "active")
    .maybeSingle();

  if (!sub) {
    // Este mensaje lo lee el CLIENTE FINAL al escanear el QR, alguien que no
    // puede hacer nada con "no tiene suscripción activa". Se le dice algo que
    // sí puede accionar, y el detalle técnico va al log del servidor para quien
    // administra la plataforma.
    console.warn(
      `validatePlanLimits: el negocio ${businessId} no tiene suscripción activa; ` +
        `se está bloqueando ${resource}. Créale una en loyalty_subscriptions.`,
    );
    return {
      ok: false,
      message: "Este comercio aún no está activo. Avísale al negocio para que lo habilite.",
    };
  }

  const plan = sub.plan as unknown as Plan;

  if (resource === "programs") {
    const { count } = await db
      .from("loyalty_programs")
      .select("id", { count: "exact" })
      .eq("business_id", businessId);

    if ((count ?? 0) >= plan.max_programs) {
      return {
        ok: false,
        message: `Plan ${plan.name} permite máximo ${plan.max_programs} programas`,
      };
    }
  } else if (resource === "members") {
    // Contar miembros en todos los programas del negocio
    const { data: programs } = await db
      .from("loyalty_programs")
      .select("id")
      .eq("business_id", businessId);

    const programIds = (programs ?? []).map((p) => (p as any).id);
    let totalMembers = 0;

    if (programIds.length > 0) {
      const { count } = await db
        .from("loyalty_members")
        .select("id", { count: "exact" })
        .in("program_id", programIds);
      totalMembers = count ?? 0;
    }

    if (totalMembers >= plan.max_members) {
      return {
        ok: false,
        message: `Plan ${plan.name} permite máximo ${plan.max_members} clientes`,
      };
    }
  }

  return { ok: true };
}

/** Crear nuevo programa (con validación de plan) */
export const createProgramWithValidationFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      name: z.string().min(2),
      stamps_required: z.number().int().positive(),
      reward_description: z.string().min(2),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser(data.token);
    const db = getSupabaseAdmin();

    // Obtener negocio
    const { data: business } = await db
      .from("loyalty_businesses")
      .select("*")
      .eq("owner_id", user.id)
      .single();

    if (!business) throw new Error("No tienes negocio");

    // Validar límites del plan
    const validation = await validatePlanLimits(business.id, "programs");
    if (!validation.ok) throw new Error(validation.message);

    // Crear programa
    const { data: program, error } = await db
      .from("loyalty_programs")
      .insert({
        business_id: business.id,
        name: data.name,
        stamps_required: data.stamps_required,
        reward_description: data.reward_description,
        active: true,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return program as Program;
  });

// --- Autenticación por username/password ---

/** Autenticar negocio con username y password */
export const authenticateBusinessFn = createServerFn({ method: "POST" })
  .validator(z.object({ username: z.string().min(1), password: z.string().min(1) }))
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();

    // maybeSingle y no single: si el username no existe queremos null, no una
    // excepción distinta que delate por el mensaje que ese usuario no está.
    const { data: cred } = await db
      .from("business_access_credentials")
      .select("*, business:loyalty_businesses(*)")
      .eq("username", data.username)
      .maybeSingle();

    // Mismo mensaje y mismo coste en CPU tanto si falla el usuario como la
    // contraseña: si saliéramos antes aquí, el tiempo de respuesta revelaría
    // qué usernames existen.
    if (!cred) {
      await dummyVerify();
      throw new Error("Usuario o contraseña incorrectos");
    }

    const { ok, needsUpgrade } = await verifyPassword(data.password, cred.password_hash);
    if (!ok) throw new Error("Usuario o contraseña incorrectos");

    // La contraseña era de las guardadas en texto plano (o con menos
    // iteraciones): ya sabemos que es correcta, así que la re-guardamos hasheada.
    // Si esto falla no bloqueamos el login — se reintentará en el siguiente.
    if (needsUpgrade) {
      try {
        await db
          .from("business_access_credentials")
          .update({ password_hash: await hashPassword(data.password) })
          .eq("id", cred.id);
      } catch (err) {
        console.warn("No se pudo migrar la contraseña a hash:", err);
      }
    }

    const business = cred.business as unknown as Business;
    return {
      // Token FIRMADO: es lo único que autoriza al cliente de aquí en adelante.
      // El businessId que viaja en el resto de campos es informativo (para pintar
      // la UI); el servidor nunca se fía de él, solo del que lleva el token dentro.
      token: await signBusinessToken(business.id),
      businessId: business.id,
      businessName: business.name,
      businessSlug: business.slug,
      username: cred.username,
    };
  });

/** Actualizar credenciales de acceso del negocio */
export const updateBusinessCredentialsFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      businessId: z.string().uuid(),
      username: z.string().min(1),
      password: z.string().min(1),
    })
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const db = getSupabaseAdmin();

    // Verificar que el negocio existe
    const { data: business } = await db
      .from("loyalty_businesses")
      .select("id")
      .eq("id", data.businessId)
      .single();

    if (!business) throw new Error("Negocio no encontrado");

    // Actualizar o crear credenciales
    const { data: existing } = await db
      .from("business_access_credentials")
      .select("id")
      .eq("business_id", data.businessId)
      .maybeSingle();

    // La contraseña en claro no se guarda nunca: solo su hash.
    const password_hash = await hashPassword(data.password);

    if (existing) {
      await db
        .from("business_access_credentials")
        .update({ username: data.username, password_hash })
        .eq("business_id", data.businessId);
    } else {
      await db.from("business_access_credentials").insert({
        business_id: data.businessId,
        username: data.username,
        password_hash,
      });
    }

    return { success: true };
  });

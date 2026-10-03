// Server functions de la vertical HOTEL: reservas y ajustes del hotel.
//
// Viven aparte de loyaltyActions.ts a propósito. Aquello son sellos y premios;
// esto son estancias. Mezclarlos en un archivo de 1800 líneas haría que cada
// vertical nueva lo engordara, y la gracia de la plataforma multi-vertical es
// justo lo contrario: que añadir un sector no obligue a tocar los demás.
//
// La AUTORIZACIÓN sí se comparte (authz.server.ts): quién puede tocar qué
// negocio es la misma pregunta en todas las verticales, y duplicarla sería
// crear un segundo sitio donde equivocarse.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Business, Program, ProgramWithWallet } from "./data";
import { getSupabaseAdmin } from "./supabaseAdmin.server";
import { requireBusinessAccess, businessIdFromSession, requireUser } from "./authz.server";
import { createMemberPass } from "./wallet/google.server";
import { getWalletConfig, getWalletConfigForProgram } from "./wallet/config.server";
import type { ReservationLike, HotelSettingsLike } from "./wallet/passes";
import {
  calcularNivel,
  resumirEstancias,
  type Nivel,
  type EstadoFidelizacion,
} from "./hotelFidelizacion";
import { regenerateApplePassBuffer } from "./wallet/apple.server";
import { getAppleWalletConfig } from "./wallet/apple-config.server";
import { notifyMemberPassUpdate } from "./wallet/apns.server";

// ---------------------------------------------------------------------------
// Tipos que ve la UI
// ---------------------------------------------------------------------------

export type HotelReservation = {
  id: string;
  memberId: string;
  guestName: string;
  /** Cédula. Se muestra en el panel del hotel, que es quien la pidió. */
  documentId: string | null;
  phone: string | null;
  reservationCode: string;
  room: string | null;
  roomType: string | null;
  guests: number;
  checkIn: string;
  checkOut: string;
  status: string;
  notes: string | null;
  /** Enlace que el hotel manda al huésped para que cree su tarjeta. */
  guestUrl: string;
  /** true si el huésped ya abrió el enlace y tiene el pase. */
  passCreated: boolean;
  /** Nivel de fidelización del huésped, o null si el hotel no tiene niveles. */
  nivel: string | null;
  /** Estancias terminadas del huésped, incluida esta si ya terminó. */
  estancias: number;
};

export type HotelSettings = {
  services: Array<{ titulo: string; url: string }>;
  guestGuide: Array<{ titulo: string; valor: string }>;
  receptionPhone: string | null;
  whatsapp: string | null;
  website: string | null;
  loyaltyLevels: Nivel[];
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Resuelve el negocio sobre el que actúa quien llama, igual que getMyDashboardFn.
 *
 * Con sesión de negocio el id sale del token FIRMADO y se ignora el que venga en
 * la petición: si se respetara, un hotel podría pedir las reservas de otro
 * cambiando un parámetro.
 */
async function resolveBusiness(token: string, businessId?: string): Promise<Business> {
  const db = getSupabaseAdmin();

  const sessionBusinessId = await businessIdFromSession(token);
  const id = sessionBusinessId ?? businessId;

  if (!id) {
    // Sin id explícito ni sesión de negocio: el primer hotel del usuario.
    const user = await requireUser(token);
    const { data } = await db
      .from("loyalty_businesses")
      .select("*")
      .eq("owner_id", user.id)
      .eq("vertical", "hotel")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!data) throw new Error("No encontramos ningún hotel en tu cuenta.");
    return data as Business;
  }

  if (!sessionBusinessId) await requireBusinessAccess(token, id);

  const { data } = await db.from("loyalty_businesses").select("*").eq("id", id).maybeSingle();
  if (!data) throw new Error("Hotel no encontrado.");
  return data as Business;
}

/**
 * Qué debe mostrar HOY la tarjeta de un huésped.
 *
 * Es el único sitio donde se decide entre las dos caras de la tarjeta, y por
 * eso lo usan tanto el panel como la página del huésped: si cada uno lo
 * decidiera por su cuenta, acabarían discrepando y el huésped vería una cosa
 * distinta según quién tocó el pase por última vez.
 *
 * Reglas:
 *   - Hay reserva confirmada o en curso -> se muestra la estancia.
 *   - No la hay y el hotel tiene niveles -> se muestra su fidelización.
 *   - No la hay y el hotel NO tiene niveles -> se deja la última estancia, que
 *     caducará sola. Es el comportamiento de antes, para los hoteles que no
 *     quieren programa de fidelización.
 */
export async function contextoHotel(
  memberId: string,
  businessId: string,
): Promise<{
  reservation: ReservationLike | null;
  settings: HotelSettingsLike;
  fidelizacion?: EstadoFidelizacion;
}> {
  const db = getSupabaseAdmin();

  const { data: reservas } = await db
    .from("hotel_reservations")
    .select("*")
    .eq("member_id", memberId)
    .order("check_in", { ascending: false });

  const { data: settings } = await db
    .from("hotel_settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  const niveles = (settings?.loyalty_levels ?? []) as Nivel[];
  const todas = (reservas ?? []) as Array<Record<string, string>>;

  const activa = todas.find((r) => r.status === "confirmada" || r.status === "en_curso") ?? null;
  const { estancias, noches } = resumirEstancias(
    todas as unknown as Array<{ status: string; check_in: string; check_out: string }>,
  );

  const hayFidelizacion = niveles.length > 0;

  return {
    // Sin fidelización se conserva la última estancia aunque esté terminada: su
    // caducidad ya la aparta sola, y cambiarla por una tarjeta vacía sería peor.
    reservation: (activa ??
      (hayFidelizacion ? null : (todas[0] ?? null))) as ReservationLike | null,
    settings: (settings ?? {
      services: [],
      guest_guide: [],
      reception_phone: null,
      whatsapp: null,
      website: null,
    }) as unknown as HotelSettingsLike,
    fidelizacion: hayFidelizacion ? calcularNivel(estancias, noches, niveles) : undefined,
  };
}

/** El programa de tipo hotel del negocio. Un hotel tiene uno solo. */
async function hotelProgram(businessId: string): Promise<Program> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from("loyalty_programs")
    .select("*")
    .eq("business_id", businessId)
    .eq("tipo", "hotel")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("Este negocio no tiene un programa de hotel configurado.");
  return data as Program;
}

function origin(): string {
  // Mismo origen público que usa el Wallet. Se reutiliza su config en vez de
  // leer la variable a mano para que el enlace del huésped y el pase no puedan
  // acabar apuntando a sitios distintos.
  return getWalletConfig().origin;
}

function toReservation(
  r: Record<string, unknown>,
  m: Record<string, unknown>,
  fidelizacion?: { nivel: string | null; estancias: number },
): HotelReservation {
  return {
    nivel: fidelizacion?.nivel ?? null,
    estancias: fidelizacion?.estancias ?? 0,
    id: r.id as string,
    memberId: r.member_id as string,
    guestName: (m?.full_name as string) ?? "—",
    documentId: (m?.document_id as string) ?? null,
    phone: (m?.phone as string) ?? null,
    reservationCode: r.reservation_code as string,
    room: (r.room as string) ?? null,
    roomType: (r.room_type as string) ?? null,
    guests: r.guests as number,
    checkIn: r.check_in as string,
    checkOut: r.check_out as string,
    status: r.status as string,
    notes: (r.notes as string) ?? null,
    guestUrl: `${origin()}/reserva/${r.access_token as string}`,
    passCreated: Boolean(m?.wallet_object_id),
  };
}

// ---------------------------------------------------------------------------
// Leer el panel
// ---------------------------------------------------------------------------

export const getHotelPanelFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), businessId: z.string().uuid().optional() }))
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();
    const business = await resolveBusiness(data.token, data.businessId);
    const program = await hotelProgram(business.id);

    // Las reservas se resuelven por los huéspedes del programa: no hay columna
    // de hotel en hotel_reservations, el hotel es el programa del huésped.
    const { data: members } = await db
      .from("loyalty_members")
      .select("id, full_name, document_id, phone, wallet_object_id")
      .eq("program_id", program.id);

    const porId = new Map((members ?? []).map((m) => [m.id as string, m]));
    const ids = [...porId.keys()];

    const { data: reservas } = ids.length
      ? await db
          .from("hotel_reservations")
          .select("*")
          .in("member_id", ids)
          .order("check_in", { ascending: false })
      : { data: [] };

    const { data: settings } = await db
      .from("hotel_settings")
      .select("*")
      .eq("business_id", business.id)
      .maybeSingle();

    // El nivel se calcula por huésped y no por reserva: dos reservas del mismo
    // huésped no pueden mostrar niveles distintos. Se agrupa primero y se
    // calcula una vez, en vez de repetir la cuenta en cada fila.
    const niveles = (settings?.loyalty_levels as Nivel[]) ?? [];
    const porHuesped = new Map<string, { nivel: string | null; estancias: number }>();
    if (niveles.length > 0) {
      for (const id of ids) {
        const suyas = (reservas ?? []).filter((r) => r.member_id === id);
        const { estancias, noches } = resumirEstancias(
          suyas as unknown as Array<{ status: string; check_in: string; check_out: string }>,
        );
        const estado = calcularNivel(estancias, noches, niveles);
        porHuesped.set(id, { nivel: estado.nivel?.nombre ?? null, estancias });
      }
    }

    return {
      business,
      programId: program.id,
      reservations: (reservas ?? []).map((r) =>
        toReservation(
          r as Record<string, unknown>,
          porId.get(r.member_id as string) ?? {},
          porHuesped.get(r.member_id as string),
        ),
      ),
      settings: {
        services: (settings?.services as HotelSettings["services"]) ?? [],
        guestGuide: (settings?.guest_guide as HotelSettings["guestGuide"]) ?? [],
        receptionPhone: (settings?.reception_phone as string) ?? null,
        whatsapp: (settings?.whatsapp as string) ?? null,
        website: (settings?.website as string) ?? null,
        loyaltyLevels: (settings?.loyalty_levels as Nivel[]) ?? [],
      } satisfies HotelSettings,
      /** false => la tarjeta sale sin botones de contacto ni guía. */
      settingsConfigured: Boolean(settings),
    };
  });

// ---------------------------------------------------------------------------
// Crear / editar una reserva
// ---------------------------------------------------------------------------

const reservaSchema = z.object({
  token: z.string(),
  businessId: z.string().uuid().optional(),
  /** Presente al editar; ausente al crear. */
  reservationId: z.string().uuid().optional(),

  guestName: z.string().trim().min(2, "El nombre es obligatorio."),
  documentId: z.string().trim().min(4, "La cédula es obligatoria."),
  phone: z.string().trim().optional(),

  reservationCode: z.string().trim().min(1, "El código de reserva es obligatorio."),
  room: z.string().trim().optional(),
  roomType: z.string().trim().optional(),
  guests: z.number().int().min(1).max(50),
  // ISO con zona horaria: la UI convierte lo que escribe el recepcionista antes
  // de mandarlo. Si llegara sin zona, el servidor (en UTC) lo interpretaría como
  // UTC y la estancia se correría cinco horas respecto a Colombia.
  checkIn: z.string().datetime({ offset: true }),
  checkOut: z.string().datetime({ offset: true }),
  status: z.enum(["confirmada", "en_curso", "finalizada", "cancelada"]).default("confirmada"),
  notes: z.string().trim().optional(),
});

export const saveReservationFn = createServerFn({ method: "POST" })
  .validator(reservaSchema)
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();
    const business = await resolveBusiness(data.token, data.businessId);
    const program = await hotelProgram(business.id);

    if (new Date(data.checkOut) <= new Date(data.checkIn)) {
      // La base también lo impide, pero su error es ilegible para el
      // recepcionista. Y la fecha de salida es la que caduca el pase: invertida,
      // la tarjeta nacería vencida.
      throw new Error("La fecha de salida debe ser posterior a la de llegada.");
    }

    // El huésped se reconoce por su cédula DENTRO de este hotel. Si ya estuvo
    // antes, se reutiliza su ficha y su MISMA tarjeta: no se emite una segunda.
    const { data: existente } = await db
      .from("loyalty_members")
      .select("id, wallet_object_id, apple_pass_serial_number, stamps")
      .eq("program_id", program.id)
      .eq("document_id", data.documentId)
      .maybeSingle();

    let memberId: string;
    if (existente) {
      memberId = existente.id as string;
      await db
        .from("loyalty_members")
        .update({
          full_name: data.guestName,
          ...(data.phone ? { phone: data.phone } : {}),
        })
        .eq("id", memberId);
    } else {
      const { data: creado, error } = await db
        .from("loyalty_members")
        .insert({
          program_id: program.id,
          full_name: data.guestName,
          document_id: data.documentId,
          phone: data.phone || null,
        })
        .select("id")
        .single();
      if (error) throw new Error(`No pudimos guardar al huésped: ${error.message}`);
      memberId = creado.id as string;
    }

    const fila = {
      member_id: memberId,
      reservation_code: data.reservationCode,
      room: data.room || null,
      room_type: data.roomType || null,
      guests: data.guests,
      check_in: data.checkIn,
      check_out: data.checkOut,
      status: data.status,
      notes: data.notes || null,
      updated_at: new Date().toISOString(),
    };

    let reservationId = data.reservationId;
    if (reservationId) {
      const { error } = await db.from("hotel_reservations").update(fila).eq("id", reservationId);
      if (error) throw new Error(`No pudimos guardar la reserva: ${error.message}`);
    } else {
      const { data: creada, error } = await db
        .from("hotel_reservations")
        .insert(fila)
        .select("id")
        .single();
      if (error) {
        // El índice único es (member_id, reservation_code).
        if (error.code === "23505") {
          throw new Error(
            `Ya existe una reserva con el código ${data.reservationCode} para este huésped.`,
          );
        }
        throw new Error(`No pudimos crear la reserva: ${error.message}`);
      }
      reservationId = creada.id as string;
    }

    const { data: reserva } = await db
      .from("hotel_reservations")
      .select("*")
      .eq("id", reservationId)
      .single();

    // Si el huésped YA tiene la tarjeta instalada, se actualiza con los datos
    // nuevos. Es la razón de ser de "una tarjeta por huésped": al volver, su
    // tarjeta de siempre pasa a mostrar la estancia nueva. Best-effort — que
    // Google falle no debe impedir guardar la reserva en el hotel.
    // Se recalcula el contexto en vez de usar la reserva recién guardada: si
    // acaban de marcarla como terminada, lo que toca enseñar ya no es esa
    // estancia sino la fidelización del huésped.
    const contexto = await contextoHotel(memberId, business.id);

    let passUpdated = false;
    if (existente?.wallet_object_id) {
      try {
        await createMemberPass(
          { id: memberId, full_name: data.guestName, stamps: (existente.stamps as number) ?? 0 },
          program,
          business,
          getWalletConfigForProgram(program as ProgramWithWallet),
          { tipo: "hotel", hotel: contexto },
        );
        passUpdated = true;
      } catch (err) {
        console.error("[hotel] no se pudo actualizar el pase:", err);
      }
    }

    // El iPhone no se entera solo: hay que refirmar el .pkpass con el MISMO
    // serial y avisar a sus dispositivos por APNs. Sin el aviso, Wallet seguiría
    // enseñando la estancia vieja hasta que al huésped se le ocurriera abrirla.
    if (existente?.apple_pass_serial_number) {
      try {
        await syncHotelApplePass(
          {
            id: memberId,
            full_name: data.guestName,
            stamps: (existente.stamps as number) ?? 0,
            serial: existente.apple_pass_serial_number as string,
          },
          program,
          business,
          contexto,
        );
      } catch (err) {
        console.error("[hotel] no se pudo actualizar el pase de Apple:", err);
      }
    }

    const { data: member } = await db
      .from("loyalty_members")
      .select("id, full_name, document_id, phone, wallet_object_id")
      .eq("id", memberId)
      .single();

    return {
      reservation: toReservation(
        reserva as Record<string, unknown>,
        member as Record<string, unknown>,
      ),
      /** true si además se refrescó la tarjeta ya instalada del huésped. */
      passUpdated,
    };
  });

export const deleteReservationFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      businessId: z.string().uuid().optional(),
      reservationId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();
    const business = await resolveBusiness(data.token, data.businessId);
    const program = await hotelProgram(business.id);

    // Se comprueba que la reserva sea de ESTE hotel antes de borrarla: el id
    // viaja desde el navegador y sin esto bastaría cambiarlo para borrar la
    // reserva de otro hotel.
    const { data: reserva } = await db
      .from("hotel_reservations")
      .select("id, member_id")
      .eq("id", data.reservationId)
      .maybeSingle();
    if (!reserva) throw new Error("Reserva no encontrada.");

    const { data: member } = await db
      .from("loyalty_members")
      .select("program_id")
      .eq("id", reserva.member_id as string)
      .maybeSingle();
    if (!member || member.program_id !== program.id) {
      throw new Error("No autorizado: esa reserva no es de este hotel.");
    }

    const { error } = await db.from("hotel_reservations").delete().eq("id", data.reservationId);
    if (error) throw new Error(`No pudimos borrar la reserva: ${error.message}`);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Ajustes del hotel (lo que sale en la tarjeta)
// ---------------------------------------------------------------------------

export const saveHotelSettingsFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      businessId: z.string().uuid().optional(),
      receptionPhone: z.string().trim().optional(),
      whatsapp: z.string().trim().optional(),
      website: z.string().trim().optional(),
      services: z
        .array(z.object({ titulo: z.string().trim().min(1), url: z.string().trim().min(1) }))
        .max(6, "Wallet solo muestra 10 enlaces; deja hueco para recepción y cómo llegar."),
      guestGuide: z
        .array(z.object({ titulo: z.string().trim().min(1), valor: z.string().trim().min(1) }))
        .max(6, "Wallet solo muestra 10 textos; los primeros los ocupa la reserva."),
      loyaltyLevels: z
        .array(
          z.object({
            nombre: z.string().trim().min(1),
            estancias: z.number().int().min(1),
            beneficio: z.string().trim().min(1),
          }),
        )
        .max(5, "Más de cinco niveles no se los aprende nadie.")
        .default([]),
    }),
  )
  .handler(async ({ data }) => {
    const db = getSupabaseAdmin();
    const business = await resolveBusiness(data.token, data.businessId);

    const fila = {
      business_id: business.id,
      reception_phone: data.receptionPhone || null,
      // wa.me necesita el número con indicativo. Sin él el botón abre WhatsApp
      // con un número incompleto y no encuentra a nadie.
      whatsapp: data.whatsapp ? normalizarWhatsapp(data.whatsapp) : null,
      website: data.website || null,
      services: data.services,
      guest_guide: data.guestGuide,
      loyalty_levels: data.loyaltyLevels,
      updated_at: new Date().toISOString(),
    };

    // upsert y no update: la primera vez no hay fila, y un update silencioso
    // sobre cero filas es exactamente cómo este hotel estuvo con la tarjeta
    // vacía sin que nadie se diera cuenta.
    const { error } = await db.from("hotel_settings").upsert(fila, { onConflict: "business_id" });
    if (error) throw new Error(`No pudimos guardar los ajustes: ${error.message}`);

    return { ok: true, whatsapp: fila.whatsapp };
  });

/**
 * Refirma el .pkpass de la estancia y avisa a los iPhone del huésped.
 *
 * Reutiliza el serial y el authenticationToken existentes: si cambiara
 * cualquiera de los dos, el pase instalado dejaría de poder hablar con nuestro
 * servicio y se quedaría congelado para siempre.
 */
async function syncHotelApplePass(
  member: { id: string; full_name: string; stamps: number; serial: string },
  program: Program,
  business: Business,
  contexto: Awaited<ReturnType<typeof contextoHotel>>,
): Promise<void> {
  const db = getSupabaseAdmin();
  const cfg = getAppleWalletConfig();

  const { data: fila } = await db
    .from("loyalty_apple_passes")
    .select("auth_token")
    .eq("pass_type_id", cfg.passTypeId)
    .eq("serial_number", member.serial)
    .maybeSingle();
  if (!fila?.auth_token) return;

  const { pkpassBuffer, mock } = await regenerateApplePassBuffer(
    member,
    program,
    business,
    member.serial,
    fila.auth_token as string,
    undefined,
    null,
    { tipo: "hotel", hotel: contexto },
  );
  if (mock || !pkpassBuffer) return;

  await db
    .from("loyalty_apple_passes")
    .update({
      signature: "\\x" + pkpassBuffer.toString("hex"),
      updated_at: new Date().toISOString(),
    })
    .eq("pass_type_id", cfg.passTypeId)
    .eq("serial_number", member.serial);

  const { data: devices } = await db
    .from("loyalty_device_registrations")
    .select("push_token")
    .eq("member_id", member.id);
  const tokens = (devices ?? []).map((d) => d.push_token as string).filter(Boolean);
  if (tokens.length > 0) await notifyMemberPassUpdate(tokens);
}

/** Deja el número en formato internacional. Asume Colombia si no trae indicativo. */
function normalizarWhatsapp(valor: string): string {
  const soloDigitos = valor.replace(/\D/g, "");
  if (valor.trim().startsWith("+")) return `+${soloDigitos}`;
  if (soloDigitos.startsWith("57") && soloDigitos.length > 10) return `+${soloDigitos}`;
  return `+57${soloDigitos}`;
}

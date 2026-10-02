// WALLET ENGINE — qué pase construye cada tipo de programa.
//
// Hasta ahora el sistema solo sabía emitir tarjetas de sellos, y eso estaba
// cableado dentro de google.server.ts. Con la plataforma multi-vertical, el
// mismo motor tiene que emitir cosas distintas: una tarjeta de fidelización y
// una tarjeta de estancia de hotel no se parecen en nada.
//
// Aquí vive SOLO la forma del pase (el JSON que entiende Google). La
// autenticación, el HTTP y los reintentos siguen en google.server.ts: son
// comunes a todos los tipos y no deben duplicarse por vertical.
//
// Para añadir una vertical nueva: un constructor más y una entrada en
// CONSTRUCTORES. Nada más.

import { stampDots } from "./dots";

// --- Datos que recibe un constructor ----------------------------------------

export type ProgramLike = {
  id: string;
  name: string;
  stamps_required: number;
  reward_description: string;
};

export type BusinessLike = {
  id: string;
  name: string;
  brand_color: string;
  logo_url: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type MemberLike = {
  id: string;
  full_name: string;
  stamps: number;
};

/** Reserva vigente del huésped. Solo para la vertical de hotel. */
export type ReservationLike = {
  reservation_code: string;
  room: string | null;
  room_type: string | null;
  guests: number;
  check_in: string;
  check_out: string;
  status: string;
};

/** Servicios, horarios y contactos del hotel. Solo para la vertical de hotel. */
export type HotelSettingsLike = {
  services: Array<{ titulo: string; url: string }>;
  guest_guide: Array<{ titulo: string; valor: string }>;
  reception_phone: string | null;
  whatsapp: string | null;
  website: string | null;
};

/**
 * Todo lo que un constructor puede necesitar.
 *
 * `hotel` es opcional en vez de usar un tipo genérico por vertical: con dos
 * verticales, un campo opcional se lee mejor que una jerarquía de tipos. Si
 * llegan cuatro o cinco, conviene revisarlo.
 */
export type PassContext = {
  business: BusinessLike;
  program: ProgramLike;
  member: MemberLike;
  hotel?: { reservation: ReservationLike; settings: HotelSettingsLike };
};

/**
 * Un constructor de pases.
 *
 * `classResource` y `objectResource` existen porque los tipos de pase viven en
 * recursos distintos de la API de Google: una tarjeta de sellos es
 * loyaltyClass/loyaltyObject y una de hotel es genericClass/genericObject. No
 * basta con cambiar el JSON, cambia también la URL.
 */
export type PassBuilder = {
  classResource: string;
  objectResource: string;
  /** Clave del payload en el JWT de "añadir a Wallet". Tambien cambia por tipo. */
  saveJwtKey: string;
  buildClass(ctx: Omit<PassContext, "member">): Record<string, unknown>;
  buildObject(ctx: PassContext, ids: { classId: string; objectId: string }): Record<string, unknown>;
};

// --- Utilidades comunes ------------------------------------------------------

/** Google exige logo. Si el comercio no subió uno, un cuadrado con su color. */
export function defaultLogoUri(business: BusinessLike): string {
  const hex = business.brand_color.replace("#", "") || "4f46e5";
  return `https://placehold.co/600x600/${hex}/ffffff/png`;
}

function programLogo(business: BusinessLike) {
  return {
    sourceUri: { uri: business.logo_url || defaultLogoUri(business) },
    contentDescription: {
      defaultValue: { language: "es", value: `Logo de ${business.name}` },
    },
  };
}

/** Ubicación para las alertas de proximidad. Google decide el radio (~150 m). */
function locations(business: BusinessLike) {
  return business.latitude != null && business.longitude != null
    ? { locations: [{ latitude: business.latitude, longitude: business.longitude }] }
    : {};
}

// --- Vertical: fidelización (sellos) ----------------------------------------
// Movido tal cual desde google.server.ts. No se cambia nada de su
// comportamiento: los pases ya emitidos deben seguir siendo idénticos.

/**
 * Módulos de texto del pase de sellos: el premio y la fila de puntos.
 *
 * Se usa al CREAR el pase y en CADA actualización. Si solo se pusiera al
 * crearlo, la fila de puntos se congelaría mientras el saldo sí avanza, y el
 * cliente vería "4/10" junto a tres puntos llenos. Google además reemplaza el
 * array entero en cada PATCH, así que hay que reenviar también el premio.
 */
export function buildLoyaltyTextModules(member: MemberLike, program: ProgramLike) {
  const dots = stampDots(member.stamps, program.stamps_required);
  return [
    {
      id: "reward",
      header: "Premio",
      body: `${program.stamps_required} sellos = ${program.reward_description}`,
    },
    ...(dots ? [{ id: "stamps", header: "Tus sellos", body: dots }] : []),
  ];
}

const loyaltyBuilder: PassBuilder = {
  classResource: "loyaltyClass",
  objectResource: "loyaltyObject",
  saveJwtKey: "loyaltyObjects",

  buildClass({ business, program }) {
    return {
      issuerName: business.name,
      programName: program.name,
      reviewStatus: "UNDER_REVIEW",
      hexBackgroundColor: business.brand_color,
      programLogo: programLogo(business),
      ...locations(business),
      textModulesData: [
        {
          id: "reward",
          header: "Premio",
          body: `${program.stamps_required} sellos = ${program.reward_description}`,
        },
      ],
    };
  },

  buildObject({ business: _business, program, member }, { classId, objectId }) {
    return {
      id: objectId,
      classId,
      state: "ACTIVE",
      accountName: member.full_name,
      // No se expone accountId: Google lo muestra como "ID de miembro" con el
      // UUID, feo e inútil para el cliente. El id sigue yendo en el QR.
      loyaltyPoints: {
        label: "Sellos",
        balance: { string: `${member.stamps}/${program.stamps_required}` },
      },
      barcode: {
        type: "QR_CODE",
        value: member.id, // el comercio escanea esto para sumar un sello
        alternateText: member.full_name,
      },
      textModulesData: buildLoyaltyTextModules(member, program),
    };
  },
};

// --- Vertical: hotel ---------------------------------------------------------

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const hotelBuilder: PassBuilder = {
  classResource: "genericClass",
  objectResource: "genericObject",
  saveJwtKey: "genericObjects",

  buildClass({ business }) {
    return {
      // El pase genérico lleva casi todo en el objeto; la clase solo aporta lo
      // común a todos los huéspedes del hotel.
      hexBackgroundColor: business.brand_color,
      logo: programLogo(business),
      ...locations(business),
    };
  },

  buildObject({ business, member, hotel }, { classId, objectId }) {
    if (!hotel) {
      // Señal de un error de programación, no de datos: si un programa es de
      // tipo hotel, quien llama debe traer la reserva. Fallar aquí es mejor que
      // emitir una tarjeta vacía al huésped.
      throw new Error("Falta la reserva para construir el pase de hotel.");
    }
    const { reservation: r, settings: s } = hotel;

    // Wallet muestra como máximo 10 enlaces del objeto. Se reservan los
    // primeros para lo que más se usa —llamar, WhatsApp, cómo llegar— y los
    // servicios del hotel ocupan el resto.
    const enlaces = [
      ...(s.reception_phone
        ? [{ uri: `tel:${s.reception_phone}`, description: "Llamar a recepción" }]
        : []),
      ...(s.whatsapp
        ? [{ uri: `https://wa.me/${s.whatsapp.replace(/\D/g, "")}`, description: "WhatsApp" }]
        : []),
      ...(business.latitude != null && business.longitude != null
        ? [
            {
              uri: `https://www.google.com/maps/search/?api=1&query=${business.latitude},${business.longitude}`,
              description: "Cómo llegar",
            },
          ]
        : []),
      ...(s.website ? [{ uri: s.website, description: "Sitio web" }] : []),
      ...s.services.slice(0, 6).map((x) => ({ uri: x.url, description: x.titulo })),
    ].slice(0, 10);

    return {
      id: objectId,
      classId,
      state: "ACTIVE",

      cardTitle: { defaultValue: { language: "es", value: business.name } },
      header: { defaultValue: { language: "es", value: member.full_name } },
      subheader: { defaultValue: { language: "es", value: `Reserva ${r.reservation_code}` } },

      // Caduca al hacer el check-out: pasada esa fecha Wallet lo pinta como
      // vencido y lo aparta de las tarjetas activas, aunque el huésped no lo
      // borre. Es lo que evita que una estancia vieja compita con la nueva.
      validTimeInterval: {
        start: { date: r.check_in },
        end: { date: r.check_out },
      },

      barcode: {
        type: "QR_CODE",
        // El QR lleva el id interno del huésped, NUNCA su cédula: el pase se
        // enseña, se fotografía y se comparte.
        value: member.id,
        alternateText: `Reserva ${r.reservation_code}`,
      },

      textModulesData: [
        ...(r.room ? [{ id: "room", header: "Habitación", body: r.room }] : []),
        { id: "checkin", header: "Check-in", body: fechaCorta(r.check_in) },
        { id: "checkout", header: "Check-out", body: fechaCorta(r.check_out) },
        { id: "guests", header: "Huéspedes", body: String(r.guests) },
        // La guía del huésped ocupa el resto. Wallet muestra 10 como máximo;
        // lo que no quepa debe ir en una página web enlazada.
        ...s.guest_guide.slice(0, 6).map((g, i) => ({
          id: `guia_${i}`,
          header: g.titulo,
          body: g.valor,
        })),
      ].slice(0, 10),

      ...(enlaces.length > 0 ? { linksModuleData: { uris: enlaces } } : {}),
    };
  },
};

// --- Selección ---------------------------------------------------------------

const CONSTRUCTORES: Record<string, PassBuilder> = {
  sellos: loyaltyBuilder,
  hotel: hotelBuilder,
};

/**
 * Constructor para un tipo de programa.
 *
 * Si el tipo no se reconoce se cae a sellos, que es lo que había antes de las
 * verticales: un programa viejo o un tipo escrito a mano en la base no debe
 * dejar a un comercio sin poder emitir tarjetas.
 */
export function getPassBuilder(tipo: string | null | undefined): PassBuilder {
  return CONSTRUCTORES[tipo ?? "sellos"] ?? loyaltyBuilder;
}

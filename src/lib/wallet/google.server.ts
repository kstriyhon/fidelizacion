// Operaciones de alto nivel contra la Google Wallet API — SOLO SERVIDOR.
//
// Conceptos:
//   - LoyaltyClass  = la PLANTILLA de la tarjeta de un comercio (logo, colores,
//     "N sellos = premio"). Se crea/actualiza una vez por programa.
//   - LoyaltyObject = la TARJETA de un cliente concreto (su saldo de sellos).
//   - "Add to Google Wallet" = un enlace con un JWT firmado (RS256) que, al
//     abrirlo en Android, guarda el LoyaltyObject en Google Wallet.
//   - Push: al hacer PATCH del objeto (subir sellos) o POST addMessage, Google
//     muestra una notificación en el celular del cliente. Sin app propia ni FCM.
//
// Si la config está en modo "mock" (sin credenciales), estas funciones NO llaman
// a Google: devuelven ids simulados y saveUrl=null, para poder demostrar el flujo.

import { getWalletConfig, type WalletConfig } from "./config.server";
import { signJwtRs256 } from "./crypto.server";

const WOBJ = "https://walletobjects.googleapis.com/walletobjects/v1";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

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

function suffix(prefix: string, id: string): string {
  return `${prefix}_${id}`.replace(/[^A-Za-z0-9._-]/g, "_");
}
export function classIdFor(cfg: WalletConfig, programId: string): string {
  return `${cfg.issuerId}.${suffix("prog", programId)}`;
}
export function objectIdFor(cfg: WalletConfig, memberId: string): string {
  return `${cfg.issuerId}.${suffix("mem", memberId)}`;
}

// Logo por defecto (Google lo exige) cuando el comercio no subió uno: un
// placeholder cuadrado con su color de marca.
function defaultLogoUri(business: BusinessLike): string {
  const hex = business.brand_color.replace("#", "") || "4f46e5";
  return `https://placehold.co/600x600/${hex}/ffffff/png`;
}

// --- Modelos que se envían a Google -----------------------------------------

function buildClass(cfg: WalletConfig, program: ProgramLike, business: BusinessLike) {
  return {
    id: classIdFor(cfg, program.id),
    issuerName: business.name,
    programName: program.name,
    reviewStatus: "UNDER_REVIEW",
    hexBackgroundColor: business.brand_color,
    // Google exige un logo. Si el comercio no subió uno, generamos un placeholder
    // con su color de marca (así siempre hay logo válido y la clase se crea).
    programLogo: {
      sourceUri: { uri: business.logo_url || defaultLogoUri(business) },
      contentDescription: {
        defaultValue: { language: "es", value: `Logo de ${business.name}` },
      },
    },
    // Ubicación para alertas de proximidad (Google decide el radio, ~150 m).
    ...(business.latitude != null && business.longitude != null
      ? { locations: [{ latitude: business.latitude, longitude: business.longitude }] }
      : {}),
    // "sellos requeridos" y premio como módulo de texto informativo.
    textModulesData: [
      {
        id: "reward",
        header: "Premio",
        body: `${program.stamps_required} sellos = ${program.reward_description}`,
      },
    ],
  };
}

function buildObject(
  cfg: WalletConfig,
  member: MemberLike,
  program: ProgramLike,
  business: BusinessLike,
) {
  return {
    id: objectIdFor(cfg, member.id),
    classId: classIdFor(cfg, program.id),
    state: "ACTIVE",
    accountName: member.full_name,
    // No exponemos accountId: Google lo muestra como "ID de miembro" con el UUID
    // (feo e inútil para el cliente). El id sigue yendo en el QR para escanear.
    loyaltyPoints: {
      label: "Sellos",
      balance: { string: `${member.stamps}/${program.stamps_required}` },
    },
    barcode: {
      type: "QR_CODE",
      value: member.id, // el comercio escanea esto para sumar un sello
      alternateText: member.full_name,
    },
    textModulesData: [
      {
        id: "reward",
        header: "Premio",
        body: `${program.stamps_required} sellos = ${program.reward_description}`,
      },
    ],
  };
}

// --- OAuth2 (service account -> access token). Solo modo live. --------------

async function getAccessToken(cfg: Extract<WalletConfig, { mode: "live" }>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwtRs256(
    {
      iss: cfg.serviceAccountEmail,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    cfg.privateKeyPem,
  );
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`OAuth token error ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function api(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${WOBJ}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

// --- API pública del módulo -------------------------------------------------

/** Crea o actualiza la LoyaltyClass del programa. Devuelve el classId. */
export async function ensureProgramClass(
  program: ProgramLike,
  business: BusinessLike,
): Promise<{ classId: string; mock: boolean }> {
  const cfg = getWalletConfig();
  const classId = classIdFor(cfg, program.id);
  if (cfg.mode === "mock") return { classId, mock: true };

  const token = await getAccessToken(cfg);
  const payload = buildClass(cfg, program, business);
  const existing = await api(token, "GET", `/loyaltyClass/${classId}`);
  if (existing.status === 404) {
    const created = await api(token, "POST", `/loyaltyClass`, payload);
    if (!created.ok) throw new Error(`create class ${created.status}: ${await created.text()}`);
  } else if (existing.ok) {
    const updated = await api(token, "PUT", `/loyaltyClass/${classId}`, payload);
    if (!updated.ok) throw new Error(`update class ${updated.status}: ${await updated.text()}`);
  } else {
    throw new Error(`get class ${existing.status}: ${await existing.text()}`);
  }
  return { classId, mock: false };
}

/**
 * Asegura la clase + crea el objeto del cliente y devuelve el enlace
 * "Add to Google Wallet". En mock devuelve saveUrl=null.
 */
export async function createMemberPass(
  member: MemberLike,
  program: ProgramLike,
  business: BusinessLike,
): Promise<{ objectId: string; saveUrl: string | null; mock: boolean }> {
  const cfg = getWalletConfig();
  const objectId = objectIdFor(cfg, member.id);

  if (cfg.mode === "mock") {
    return { objectId, saveUrl: null, mock: true };
  }

  await ensureProgramClass(program, business);
  const token = await getAccessToken(cfg);
  const object = buildObject(cfg, member, program, business);

  const existing = await api(token, "GET", `/loyaltyObject/${objectId}`);
  if (existing.status === 404) {
    const created = await api(token, "POST", `/loyaltyObject`, object);
    if (!created.ok) throw new Error(`create object ${created.status}: ${await created.text()}`);
  } else if (existing.ok) {
    const updated = await api(token, "PUT", `/loyaltyObject/${objectId}`, object);
    if (!updated.ok) throw new Error(`update object ${updated.status}: ${await updated.text()}`);
  } else {
    throw new Error(`get object ${existing.status}: ${await existing.text()}`);
  }

  // JWT "save to wallet". Se referencia el objeto ya creado por id.
  const now = Math.floor(Date.now() / 1000);
  const saveJwt = await signJwtRs256(
    {
      iss: cfg.serviceAccountEmail,
      aud: "google",
      typ: "savetowallet",
      iat: now,
      origins: [cfg.origin],
      payload: { loyaltyObjects: [{ id: objectId, classId: object.classId }] },
    },
    cfg.privateKeyPem,
  );
  return { objectId, saveUrl: `https://pay.google.com/gp/v/save/${saveJwt}`, mock: false };
}

/**
 * Actualiza el saldo de sellos del objeto (dispara push) y, opcionalmente,
 * envía un mensaje (otra notificación). En mock no hace nada.
 */
export async function pushStampUpdate(
  member: MemberLike,
  program: ProgramLike,
  message?: { header: string; body: string },
): Promise<{ pushed: boolean; mock: boolean }> {
  const cfg = getWalletConfig();
  if (cfg.mode === "mock") return { pushed: false, mock: true };

  const objectId = objectIdFor(cfg, member.id);
  const token = await getAccessToken(cfg);

  // PATCH del saldo -> Google notifica el cambio en el celular.
  const patched = await api(token, "PATCH", `/loyaltyObject/${objectId}`, {
    loyaltyPoints: {
      label: "Sellos",
      balance: { string: `${member.stamps}/${program.stamps_required}` },
    },
  });
  if (!patched.ok) throw new Error(`patch object ${patched.status}: ${await patched.text()}`);

  if (message) {
    const msg = await api(token, "POST", `/loyaltyObject/${objectId}/addMessage`, {
      // TEXT_AND_NOTIFY = además de guardarse en el pase, dispara notificación push.
      message: {
        header: message.header,
        body: message.body,
        id: `m_${Date.now()}`,
        messageType: "TEXT_AND_NOTIFY",
      },
    });
    if (!msg.ok) throw new Error(`addMessage ${msg.status}: ${await msg.text()}`);
  }
  return { pushed: true, mock: false };
}

/**
 * PATCH genérico del LoyaltyObject de un cliente (ej. accountName, state).
 * No falla si el objeto no existe (404). En mock no hace nada.
 */
export async function patchLoyaltyObject(
  memberId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; mock: boolean }> {
  const cfg = getWalletConfig();
  if (cfg.mode === "mock") return { ok: false, mock: true };
  const objectId = objectIdFor(cfg, memberId);
  const token = await getAccessToken(cfg);
  const res = await api(token, "PATCH", `/loyaltyObject/${objectId}`, patch);
  if (!res.ok && res.status !== 404) {
    throw new Error(`patch object ${res.status}: ${await res.text()}`);
  }
  return { ok: res.ok, mock: false };
}

/**
 * Envía un mensaje puntual a la tarjeta de un cliente (sin cambiar sellos).
 * Útil para felicitaciones de cumpleaños, promos personales, etc. Dispara push.
 */
export async function pushMessage(
  memberId: string,
  message: { header: string; body: string },
): Promise<{ sent: boolean; mock: boolean }> {
  const cfg = getWalletConfig();
  if (cfg.mode === "mock") return { sent: false, mock: true };

  const objectId = objectIdFor(cfg, memberId);
  const token = await getAccessToken(cfg);
  const msg = await api(token, "POST", `/loyaltyObject/${objectId}/addMessage`, {
    message: {
      header: message.header,
      body: message.body,
      id: `m_${Date.now()}`,
      messageType: "TEXT_AND_NOTIFY",
    },
  });
  if (!msg.ok) throw new Error(`addMessage ${msg.status}: ${await msg.text()}`);
  return { sent: true, mock: false };
}

/**
 * Envía un mensaje a TODOS los clientes de un programa a la vez (broadcast), vía
 * el mensaje a nivel de LoyaltyClass — el mecanismo oficial de Google para avisar
 * a todos los poseedores de un pase. Dispara push a cada uno.
 * OJO: Google limita a 3 notificaciones por pase cada 24 h y throttlea el spam.
 */
export async function broadcastToClass(
  programId: string,
  message: { header: string; body: string },
): Promise<{ sent: boolean; mock: boolean }> {
  const cfg = getWalletConfig();
  if (cfg.mode === "mock") return { sent: false, mock: true };

  const classId = classIdFor(cfg, programId);
  const token = await getAccessToken(cfg);
  const res = await api(token, "POST", `/loyaltyClass/${classId}/addMessage`, {
    message: {
      header: message.header,
      body: message.body,
      id: `bcast_${Date.now()}`,
      messageType: "TEXT_AND_NOTIFY",
    },
  });
  if (!res.ok) throw new Error(`class addMessage ${res.status}: ${await res.text()}`);
  return { sent: true, mock: false };
}

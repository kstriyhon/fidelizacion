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

import { getWalletConfig, getWalletConfigForProgram, type WalletConfig } from "./config.server";
import { signJwtRs256 } from "./crypto.server";
import {
  getPassBuilder,
  buildLoyaltyTextModules,
  type PassContext,
  type ProgramLike,
  type BusinessLike,
  type MemberLike,
} from "./passes";

// Se re-exportan para no romper a quien ya los importaba de aqui.
export type { ProgramLike, BusinessLike, MemberLike } from "./passes";

const WOBJ = "https://walletobjects.googleapis.com/walletobjects/v1";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const KV_TOKEN_KEY = "google_oauth_token";

// Caché en memoria como fallback (para desarrollo local)
let cachedToken: { token: string; expiresAt: number } | null = null;

// Obtener el binding de Cloudflare KV (si está disponible)
// KV se accede mediante el contexto de Cloudflare Workers
function getKVCache() {
  try {
    // En Cloudflare Workers, KV está disponible vía importHttp
    if (typeof globalThis !== "undefined") {
      const g = globalThis as any;
      // Intentar acceder a KV mediante diferentes mecanismos posibles
      return g.KV_CACHE || g.__KV__ || null;
    }
  } catch (e) {
    // Silenciosamente fallar si no está disponible
  }
  return null;
}


function suffix(prefix: string, id: string): string {
  return `${prefix}_${id}`.replace(/[^A-Za-z0-9._-]/g, "_");
}
export function classIdFor(cfg: WalletConfig, programId: string): string {
  return `${cfg.issuerId}.${suffix("prog", programId)}`;
}
export function objectIdFor(cfg: WalletConfig, memberId: string): string {
  return `${cfg.issuerId}.${suffix("mem", memberId)}`;
}


// --- Modelos que se envían a Google -----------------------------------------




// --- OAuth2 (service account -> access token). Solo modo live. --------------

async function getAccessToken(cfg: Extract<WalletConfig, { mode: "live" }>): Promise<string> {
  const now = Date.now();
  const kv = getKVCache();

  // Intentar obtener del caché en memoria primero (fallback local)
  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.token;
  }

  // Intentar obtener de KV Storage (Cloudflare)
  if (kv) {
    try {
      const cached = await kv.get(KV_TOKEN_KEY, "json");
      if (cached && cached.expiresAt > now) {
        cachedToken = cached; // actualizar caché local
        return cached.token;
      }
    } catch (err) {
      // Si KV falla, continuar sin caché
      console.error("KV cache read failed:", err);
    }
  }

  // Obtener nuevo token de Google OAuth
  const nowSec = Math.floor(now / 1000);
  const assertion = await signJwtRs256(
    {
      iss: cfg.serviceAccountEmail,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600,
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
  const token = ((await res.json()) as { access_token: string }).access_token;
  const tokenData = { token, expiresAt: now + 3600 * 1000 - 60000 };

  // Guardar en caché local
  cachedToken = tokenData;

  // Guardar en KV Storage (Cloudflare)
  if (kv) {
    try {
      await kv.put(KV_TOKEN_KEY, JSON.stringify(tokenData), { expirationTtl: 3540 });
    } catch (err) {
      console.error("KV cache write failed:", err);
      // No es fatal si KV falla
    }
  }

  return token;
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
  cfg?: WalletConfig,
  tipo?: string,
): Promise<{ classId: string; mock: boolean }> {
  cfg = cfg ?? getWalletConfig();
  const classId = classIdFor(cfg, program.id);
  if (cfg.mode === "mock") return { classId, mock: true };

  const builder = getPassBuilder(tipo);
  const token = await getAccessToken(cfg);
  const payload = { id: classId, ...builder.buildClass({ program, business }) };
  const existing = await api(token, "GET", `/${builder.classResource}/${classId}`);
  if (existing.status === 404) {
    const created = await api(token, "POST", `/${builder.classResource}`, payload);
    if (!created.ok) throw new Error(`create class ${created.status}: ${await created.text()}`);
  } else if (existing.ok) {
    const updated = await api(token, "PUT", `/${builder.classResource}/${classId}`, payload);
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
  cfg?: WalletConfig,
  /** Tipo de programa y, si es hotel, su reserva y ajustes. */
  extra?: { tipo?: string; hotel?: PassContext["hotel"] },
): Promise<{ objectId: string; saveUrl: string | null; mock: boolean }> {
  cfg = cfg ?? getWalletConfig();
  const objectId = objectIdFor(cfg, member.id);

  if (cfg.mode === "mock") {
    return { objectId, saveUrl: null, mock: true };
  }

  const builder = getPassBuilder(extra?.tipo);
  const { classId } = await ensureProgramClass(program, business, cfg, extra?.tipo);
  const token = await getAccessToken(cfg);
  const object = builder.buildObject(
    { business, program, member, hotel: extra?.hotel },
    { classId, objectId },
  );

  const existing = await api(token, "GET", `/${builder.objectResource}/${objectId}`);
  if (existing.status === 404) {
    const created = await api(token, "POST", `/${builder.objectResource}`, object);
    if (!created.ok) throw new Error(`create object ${created.status}: ${await created.text()}`);
  } else if (existing.ok) {
    const updated = await api(token, "PUT", `/${builder.objectResource}/${objectId}`, object);
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
      payload: { [builder.saveJwtKey]: [{ id: objectId, classId }] },
    },
    cfg.privateKeyPem,
  );
  return { objectId, saveUrl: `https://pay.google.com/gp/v/save/${saveJwt}`, mock: false };
}

/**
 * Actualiza el saldo de sellos del objeto (dispara push) y, opcionalmente,
 * envía un mensaje (otra notificación). En mock no hace nada.
 */
/**
 * @param notificar  false manda el mensaje como TEXT en vez de TEXT_AND_NOTIFY:
 *   aparece en la tarjeta pero NO pide notificación. Se usa al pasar del límite
 *   de Google (3 notificaciones por tarjeta cada 24 h). Pedirlas igualmente no
 *   las entrega: las encola y llegan horas después, de golpe — y Google avisa
 *   de que recorta la cuota a quien ve abusando.
 */
export async function pushStampUpdate(
  member: MemberLike,
  program: ProgramLike,
  message?: { header: string; body: string },
  cfg?: WalletConfig,
  notificar: boolean = true,
): Promise<{ pushed: boolean; mock: boolean }> {
  cfg = cfg ?? getWalletConfig();
  if (cfg.mode === "mock") return { pushed: false, mock: true };

  const objectId = objectIdFor(cfg, member.id);
  const token = await getAccessToken(cfg);

  // PATCH del saldo -> Google notifica el cambio en el celular.
  // Va también textModulesData para que la fila de puntos avance con el saldo:
  // si solo se mandara loyaltyPoints, la tarjeta diría "4/10" con tres puntos
  // llenos.
  const patched = await api(token, "PATCH", `/loyaltyObject/${objectId}`, {
    loyaltyPoints: {
      label: "Sellos",
      balance: { string: `${member.stamps}/${program.stamps_required}` },
    },
    textModulesData: buildLoyaltyTextModules(member, program),
  });
  if (!patched.ok) throw new Error(`patch object ${patched.status}: ${await patched.text()}`);

  if (message) {
    const msg = await api(token, "POST", `/loyaltyObject/${objectId}/addMessage`, {
      // TEXT_AND_NOTIFY = además de guardarse en el pase, dispara notificación push.
      message: {
        header: message.header,
        body: message.body,
        id: `m_${Date.now()}`,
        messageType: notificar ? "TEXT_AND_NOTIFY" : "TEXT",
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
  cfg?: WalletConfig,
): Promise<{ ok: boolean; mock: boolean }> {
  cfg = cfg ?? getWalletConfig();
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
  cfg?: WalletConfig,
): Promise<{ sent: boolean; mock: boolean }> {
  cfg = cfg ?? getWalletConfig();
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
  cfg?: WalletConfig,
): Promise<{ sent: boolean; mock: boolean }> {
  cfg = cfg ?? getWalletConfig();
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

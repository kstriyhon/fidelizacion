// Sesión de negocio para el acceso por usuario/contraseña de /p/{slug} — SOLO SERVIDOR.
//
// Antes, /p/{slug} validaba las credenciales y el cliente se limitaba a guardar
// un JSON en localStorage. Eso no es una sesión: cualquiera podía escribir a mano
// el businessId de otro comercio desde la consola del navegador. Aquí se emite un
// token FIRMADO por el servidor, así que su contenido no se puede alterar sin
// romper la firma.
//
// Formato:  fb1.<payload_base64url>.<firma_base64url>
// El prefijo "fb1." distingue estos tokens de los access_token de Supabase, para
// no tener que adivinar cuál es cuál al autorizar.
//
// La clave de firma se DERIVA de SUPABASE_SERVICE_ROLE_KEY en vez de pedir un
// secreto nuevo: así no hay que configurar ni desplegar nada extra. Efecto
// secundario deseable: si algún día rotas la service key, todas las sesiones de
// negocio quedan invalidadas de golpe.

const PREFIX = "fb1";

// Un día de trabajo. Se pide login de nuevo al día siguiente, que es lo prudente
// para una tablet que vive en el mostrador de un local. Subirlo es cambiar este
// número (los tokens ya emitidos siguen siendo válidos hasta su propio exp).
const TTL_SECONDS = 12 * 60 * 60;

type Payload = { b: string; iat: number; exp: number };

function env(name: string): string | undefined {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
    name
  ];
  return v && v.trim() !== "" ? v : undefined;
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let cachedKey: CryptoKey | null = null;

async function signingKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const secret = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) {
    throw new Error(
      "Falta SUPABASE_SERVICE_ROLE_KEY: no se puede firmar la sesión de negocio.",
    );
  }
  // No se usa la service key en crudo como clave HMAC: se deriva con SHA-256
  // junto a una etiqueta de propósito, para que este uso quede separado de
  // cualquier otro que se le dé a esa key.
  const material = new TextEncoder().encode(`fideliza:business-session:v1:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  cachedKey = await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return cachedKey;
}

/** Comparación en tiempo constante. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Emite un token firmado que acredita el acceso a UN negocio concreto. */
export async function signBusinessToken(businessId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Payload = { b: businessId, iat: now, exp: now + TTL_SECONDS };
  const body = `${PREFIX}.${b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))}`;
  const sig = await crypto.subtle.sign("HMAC", await signingKey(), new TextEncoder().encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** true si el token TIENE FORMA de sesión de negocio (no dice si es válido). */
export function looksLikeBusinessToken(token: string | undefined | null): boolean {
  return typeof token === "string" && token.startsWith(PREFIX + ".");
}

/**
 * Verifica firma y caducidad. Devuelve el businessId, o null si el token es
 * inválido, está manipulado o expiró. Nunca lanza: quien llama decide el error.
 */
export async function verifyBusinessToken(
  token: string | undefined | null,
): Promise<string | null> {
  if (!looksLikeBusinessToken(token)) return null;
  const parts = (token as string).split(".");
  if (parts.length !== 3) return null;

  const body = `${parts[0]}.${parts[1]}`;
  let expected: Uint8Array;
  try {
    expected = b64urlDecode(parts[2]);
  } catch {
    return null;
  }

  const actual = new Uint8Array(
    await crypto.subtle.sign("HMAC", await signingKey(), new TextEncoder().encode(body)),
  );
  if (!timingSafeEqual(actual, expected)) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch {
    return null;
  }

  if (typeof payload.b !== "string" || !payload.b) return null;
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;

  return payload.b;
}

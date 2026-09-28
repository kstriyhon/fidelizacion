// Hash y verificación de contraseñas — SOLO SERVIDOR.
//
// Por qué PBKDF2 y no bcrypt: esto corre en Cloudflare Workers, donde bcrypt
// (binding nativo) no carga. PBKDF2 está en la Web Crypto API que el runtime ya
// expone, así que no añade dependencias ni sorpresas en el build.
//
// Formato almacenado:  pbkdf2$<iteraciones>$<salt_b64>$<hash_b64>
// Guardar las iteraciones dentro del propio valor permite subirlas más adelante
// sin invalidar las contraseñas ya guardadas: cada hash se verifica con las
// iteraciones con las que se creó, y se re-hashea al entrar.

const PREFIX = "pbkdf2";
const HASH = "SHA-256";
const SALT_BYTES = 16;
const KEY_BITS = 256;

// Compromiso deliberado. OWASP pide más para PBKDF2-HMAC-SHA256, pero cada
// login gasta este trabajo en el CPU del Worker, que es un recurso acotado.
// 100k sigue estando a un mundo de distancia del texto plano; si algún día se
// sube, los hashes viejos siguen validando solos (ver nota del formato).
const ITERATIONS = 100_000;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// El parámetro se tipa como Uint8Array<ArrayBuffer> (y no Uint8Array a secas)
// porque deriveBits exige BufferSource, y desde TS 5.7 un Uint8Array genérico
// puede estar respaldado por un SharedArrayBuffer, que no encaja ahí.
async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: HASH },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Comparación en tiempo constante: no revela en qué byte difieren. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** true si el valor guardado ya está hasheado (vs. texto plano heredado). */
export function isHashed(stored: string): boolean {
  return stored.startsWith(PREFIX + "$");
}

/** Genera el valor a guardar en la columna password_hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

/**
 * Verifica una contraseña contra el valor guardado.
 *
 * Acepta también los valores en TEXTO PLANO que quedaron de la primera versión
 * de esta feature, para que nadie se quede fuera al desplegar. Cuando uno de
 * esos acierta, devuelve needsUpgrade: true y quien llama debe re-guardar el
 * valor ya hasheado — así las contraseñas viejas migran solas al usarse.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (!isHashed(stored)) {
    // Heredado en texto plano. Comparación en tiempo constante igualmente.
    const enc = new TextEncoder();
    const ok = timingSafeEqual(enc.encode(password), enc.encode(stored));
    return { ok, needsUpgrade: ok };
  }

  const parts = stored.split("$");
  if (parts.length !== 4) return { ok: false, needsUpgrade: false };

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return { ok: false, needsUpgrade: false };
  }

  let salt: Uint8Array<ArrayBuffer>;
  let expected: Uint8Array;
  try {
    salt = fromB64(parts[2]);
    expected = fromB64(parts[3]);
  } catch {
    return { ok: false, needsUpgrade: false };
  }

  const actual = await derive(password, salt, iterations);
  const ok = timingSafeEqual(actual, expected);
  // Si el hash se creó con menos iteraciones de las que usamos hoy, se re-hashea.
  return { ok, needsUpgrade: ok && iterations < ITERATIONS };
}

/**
 * Consume el mismo trabajo de CPU que una verificación real, sin comparar nada.
 *
 * Se usa cuando el username no existe: sin esto, un "usuario inexistente"
 * respondería mucho más rápido que un "contraseña incorrecta", y esa diferencia
 * de tiempo permite averiguar qué usernames están dados de alta.
 */
export async function dummyVerify(): Promise<void> {
  const salt = new Uint8Array(SALT_BYTES);
  await derive("", salt, ITERATIONS);
}

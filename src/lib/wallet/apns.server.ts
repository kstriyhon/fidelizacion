// APNs (Apple Push Notification service) — Envío de notificaciones push
// SOLO SERVIDOR. Usa JWT ES256 para autenticarse con los servidores de Apple.
//
// IMPORTANTE (spec real de PassKit, no un app normal con su propio bundle id):
// para pases de Wallet, el push es SIEMPRE "silencioso" — payload
// `{"aps":{}}` y header `apns-topic` = passTypeIdentifier. Apple NO permite
// texto de alerta custom en el push de un pase; el push solo le dice a
// Wallet "andá a buscar la versión nueva" (GET al PassKit web service). El
// texto que el usuario ve sale de `changeMessage` en el campo del pase que
// cambió (ver buildPassInstance en apple.server.ts), no de este payload.
//
// Si está en modo "mock", no hace llamadas reales a Apple.

import { getAppleWalletConfig, decodeBase64PrivateKey, type AppleWalletConfig } from "./apple-config.server";

const APNS_HOST = "https://api.push.apple.com";
const APNS_PATH = "/3/device";
const JWT_ALGORITHM = "ES256";

// --- Firma JWT ES256 ---

/**
 * Genera un JWT ES256 para autenticarse con APNs.
 * Usa Web Crypto API (compatible con Workers).
 */
async function generateAPNsJWT(
  teamId: string,
  keyId: string,
  privateKeyP8: Buffer
): Promise<string> {
  try {
    // 1. Parsear la clave privada P8 (PKCS#8)
    // El formato P8 es: -----BEGIN PRIVATE KEY----- (base64) -----END PRIVATE KEY-----
    const keyPem = privateKeyP8.toString("utf-8");

    // Extraer el contenido base64 entre BEGIN y END
    const keyBase64 = keyPem
      .split("\n")
      .filter((line) => !line.includes("-----"))
      .join("");
    const keyDer = Buffer.from(keyBase64, "base64");

    // 2. Importar la clave usando Web Crypto
    const key = await crypto.subtle.importKey(
      "pkcs8",
      keyDer,
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      false,
      ["sign"]
    );

    // 3. Crear el JWT
    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: JWT_ALGORITHM,
      kid: keyId,
    };
    const payload = {
      iss: teamId,
      iat: now,
    };

    const headerJson = JSON.stringify(header);
    const payloadJson = JSON.stringify(payload);

    const headerB64 = btoa(headerJson).replace(/[+/]/g, (c) => (c === "+" ? "-" : "_")).replace(/=/g, "");
    const payloadB64 = btoa(payloadJson).replace(/[+/]/g, (c) => (c === "+" ? "-" : "_")).replace(/=/g, "");

    // 4. Firmar (ES256 = SHA-256 + ECDSA). Web Crypto devuelve la firma en
    // formato IEEE P1363 (r||s de 64 bytes) que es exactamente lo que JWS
    // ES256 espera — no hace falta reempaquetar a DER.
    const message = `${headerB64}.${payloadB64}`;
    const messageBuffer = new TextEncoder().encode(message);

    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      messageBuffer,
    );
    const signatureB64 = Buffer.from(signature)
      .toString("base64")
      .replace(/[+/]/g, (c) => (c === "+" ? "-" : "_"))
      .replace(/=/g, "");

    return `${message}.${signatureB64}`;
  } catch (error) {
    throw new Error(`Failed to generate APNs JWT: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// --- Envío de notificaciones ---

/**
 * Envía el push "silencioso" de actualización de pase a una lista de
 * dispositivos. Es la única forma válida de push para PassKit — le dice a
 * Wallet que vaya a re-descargar el pase actualizado.
 */
export async function sendAPNsPassUpdate(
  deviceTokens: string[],
  cfg: Extract<AppleWalletConfig, { mode: "live" }>
): Promise<{
  successful: string[];
  failed: Array<{ token: string; status: number; error: string }>;
}> {
  if (deviceTokens.length === 0) {
    return { successful: [], failed: [] };
  }

  const jwtToken = await generateAPNsJWT(cfg.teamId, cfg.keyId, decodeBase64PrivateKey(cfg.apnsPrivateKeyP8Base64));

  const successful: string[] = [];
  const failed: Array<{ token: string; status: number; error: string }> = [];

  const results = await Promise.allSettled(
    deviceTokens.map(async (token) => {
      const response = await fetch(`${APNS_HOST}${APNS_PATH}/${token}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${jwtToken}`,
          "content-type": "application/json",
          "apns-topic": cfg.passTypeId,
          "apns-push-type": "background",
          "apns-priority": "5",
        },
        // Payload obligatorio para pases: aps vacío. Nada de alert/sound.
        body: JSON.stringify({ aps: {} }),
      });

      if (response.ok) {
        successful.push(token);
      } else {
        const errorText = await response.text();
        failed.push({ token, status: response.status, error: errorText });
      }
    }),
  );

  // Cualquier rechazo de red no capturado arriba (no debería pasar, pero por
  // las dudas no se pierde silenciosamente).
  for (const r of results) {
    if (r.status === "rejected") {
      failed.push({ token: "unknown", status: 0, error: String(r.reason) });
    }
  }

  return { successful, failed };
}

/**
 * Envía el push de actualización a los dispositivos registrados de UN
 * cliente (tras dar un sello, canjear, o mandarle un mensaje puntual).
 */
export async function notifyMemberPassUpdate(
  deviceTokens: string[],
): Promise<{ sent: number; failed: number; mock: boolean }> {
  const cfg = getAppleWalletConfig();
  if (cfg.mode === "mock") return { sent: 0, failed: 0, mock: true };
  if (deviceTokens.length === 0) return { sent: 0, failed: 0, mock: false };

  try {
    const result = await sendAPNsPassUpdate(deviceTokens, cfg);
    return { sent: result.successful.length, failed: result.failed.length, mock: false };
  } catch (error) {
    console.error("Error sending Apple pass update push:", error);
    return { sent: 0, failed: deviceTokens.length, mock: false };
  }
}


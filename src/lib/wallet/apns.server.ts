// APNs (Apple Push Notification service) — Envío de notificaciones push
// SOLO SERVIDOR. Usa JWT ES256 para autenticarse con los servidores de Apple.
//
// Flujo:
// 1. Generar JWT con la clave privada del APNs
// 2. POST a api.push.apple.com con el token y el mensaje
// 3. Apple entrega la notificación al dispositivo
//
// Si está en modo "mock", no hace llamadas reales a Apple.

import { getAppleWalletConfig, decodeBase64PrivateKey, type AppleWalletConfig } from "./apple-config.server";

// Constantes de APNs
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
      .slice(1, -1)
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

    // 4. Firmar (ES256 = SHA-256 + ECDSA)
    const message = `${headerB64}.${payloadB64}`;
    const messageBuffer = new TextEncoder().encode(message);

    const signature = await crypto.subtle.sign("ECDSA", key, messageBuffer);
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

interface APNsPayload {
  aps: {
    alert?: {
      title?: string;
      body: string;
    };
    sound?: string;
    "mutable-content"?: 1;
    "push-type"?: "alert" | "background";
  };
}

/**
 * Envía una notificación push a un dispositivo via APNs.
 * Retorna éxito/fallo para cada dispositivo.
 */
export async function sendAPNsNotification(
  deviceTokens: string[],
  alert: string,
  cfg: Extract<AppleWalletConfig, { mode: "live" }>
): Promise<{
  successful: string[];
  failed: Array<{ token: string; error: string }>;
}> {
  try {
    // Generar JWT una sola vez (válido por 1 hora)
    const jwtToken = await generateAPNsJWT(cfg.teamId, cfg.keyId, decodeBase64PrivateKey(cfg.apnsPrivateKeyP8Base64));

    const successful: string[] = [];
    const failed: Array<{ token: string; error: string }> = [];

    // Enviar a cada dispositivo en paralelo
    const promises = deviceTokens.map(async (token) => {
      try {
        const payload: APNsPayload = {
          aps: {
            alert: {
              body: alert,
            },
            sound: "default",
            "mutable-content": 1,
            "push-type": "alert",
          },
        };

        const response = await fetch(`${APNS_HOST}${APNS_PATH}/${token}`, {
          method: "POST",
          headers: {
            authorization: `bearer ${jwtToken}`,
            "content-type": "application/json",
            "apns-priority": "10",
            "apns-push-type": "alert",
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          successful.push(token);
        } else {
          const errorText = await response.text();
          failed.push({
            token,
            error: `${response.status}: ${errorText}`,
          });
        }
      } catch (error) {
        failed.push({
          token,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await Promise.all(promises);

    return { successful, failed };
  } catch (error) {
    throw new Error(`Failed to send APNs notifications: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// --- API pública ---

/**
 * Envía una notificación de sello a un cliente.
 * Busca los dispositivos registrados y envía via APNs.
 */
export async function notifyStampUpdate(
  serialNumber: string,
  stamps: number,
  stampsRequired: number,
  businessName: string,
  deviceTokens: string[]
): Promise<{ sent: number; failed: number; mock: boolean }> {
  const cfg = getAppleWalletConfig();

  if (cfg.mode === "mock") {
    return { sent: 0, failed: 0, mock: true };
  }

  try {
    const message = `¡Nuevo sello! 🎉 Tienes ${stamps}/${stampsRequired} sellos en ${businessName}`;
    const result = await sendAPNsNotification(deviceTokens, message, cfg);

    return {
      sent: result.successful.length,
      failed: result.failed.length,
      mock: false,
    };
  } catch (error) {
    console.error("Error notifying stamp update:", error);
    return { sent: 0, failed: deviceTokens.length, mock: false };
  }
}

/**
 * Envía una notificación personalizada a un cliente.
 */
export async function notifyPersonalMessage(
  businessName: string,
  title: string,
  body: string,
  deviceTokens: string[]
): Promise<{ sent: number; failed: number; mock: boolean }> {
  const cfg = getAppleWalletConfig();

  if (cfg.mode === "mock") {
    return { sent: 0, failed: 0, mock: true };
  }

  try {
    const message = `${businessName}: ${body}`;
    const result = await sendAPNsNotification(deviceTokens, message, cfg);

    return {
      sent: result.successful.length,
      failed: result.failed.length,
      mock: false,
    };
  } catch (error) {
    console.error("Error notifying personal message:", error);
    return { sent: 0, failed: deviceTokens.length, mock: false };
  }
}

/**
 * Envía una notificación de broadcast a múltiples dispositivos.
 */
export async function notifyBroadcast(
  businessName: string,
  message: string,
  allDeviceTokens: string[]
): Promise<{ sent: number; failed: number; mock: boolean }> {
  const cfg = getAppleWalletConfig();

  if (cfg.mode === "mock") {
    return { sent: 0, failed: 0, mock: true };
  }

  try {
    const fullMessage = `${businessName}: ${message}`;
    const result = await sendAPNsNotification(allDeviceTokens, fullMessage, cfg);

    return {
      sent: result.successful.length,
      failed: result.failed.length,
      mock: false,
    };
  } catch (error) {
    console.error("Error notifying broadcast:", error);
    return { sent: 0, failed: allDeviceTokens.length, mock: false };
  }
}

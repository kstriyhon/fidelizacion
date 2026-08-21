// Configuración de Apple Wallet (PassKit) — SOLO SERVIDOR.
// Nunca importar esto desde código que llegue al bundle del cliente: contiene
// (o lee) certificados privados, que son SECRETOS.
//
// Fuentes de las variables:
//   - Local (vite dev / node): process.env (usa .dev.vars)
//   - Cloudflare Workers: setear como *secrets* de runtime
//       (wrangler secret put APPLE_WALLET_*, etc.)
//     Con nodejs_compat, Nitro las expone en process.env.
//
// Si falta cualquiera de las credenciales, corremos en modo "mock": el flujo
// completo funciona en la app pero NO se emite un pase real de Apple Wallet.
// Así se puede desarrollar y demostrar sin credenciales; en cuanto se
// configuren, pasa a live.

export type AppleWalletConfig =
  | {
      mode: "live";
      teamId: string;
      passTypeId: string;
      keyId: string;
      certificateP12Base64: string;
      certificatePassword: string;
      wwdrCertificateBase64: string;
      apnsPrivateKeyP8Base64: string;
      origin: string;
    }
  | {
      mode: "mock";
      teamId: string;
      passTypeId: string;
      origin: string;
    };

function env(name: string): string | undefined {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[name];
  return v && v.trim() !== "" ? v : undefined;
}

/**
 * Lee configuración de Apple Wallet desde environment.
 * En modo mock, omite las credenciales y simula todo.
 */
export function getAppleWalletConfig(): AppleWalletConfig {
  const teamId = env("APPLE_WALLET_TEAM_ID") ?? "RBTWYC5AP6";
  const passTypeId = env("APPLE_WALLET_PASS_TYPE_ID") ?? "pass.loyalty.fideliza";
  const keyId = env("APPLE_WALLET_KEY_ID") ?? "44BN3F598N";
  const origin = env("PUBLIC_APP_ORIGIN") ?? "http://localhost:8080";

  const certificateP12Base64 = env("APPLE_WALLET_CERT_P12_BASE64");
  const certificatePassword = env("APPLE_WALLET_CERT_PASSWORD");
  const wwdrCertificateBase64 = env("APPLE_WALLET_WWDR_CERT_BASE64");
  const apnsPrivateKeyP8Base64 = env("APPLE_WALLET_APNS_KEY_P8_BASE64");

  // Modo live: todas las credenciales presentes
  if (
    certificateP12Base64 &&
    certificatePassword &&
    wwdrCertificateBase64 &&
    apnsPrivateKeyP8Base64
  ) {
    return {
      mode: "live",
      teamId,
      passTypeId,
      keyId,
      certificateP12Base64,
      certificatePassword,
      wwdrCertificateBase64,
      apnsPrivateKeyP8Base64,
      origin,
    };
  }

  // Modo mock (desarrollo sin certificados)
  return {
    mode: "mock",
    teamId,
    passTypeId,
    origin,
  };
}

/**
 * Decodifica un certificado base64 a Buffer (DER o PEM).
 * Se usa para cargar certificados desde environment variables.
 */
export function decodeBase64Certificate(base64: string): Buffer {
  return Buffer.from(base64, "base64");
}

/**
 * Decodifica una clave privada P8 base64 a Buffer.
 */
export function decodeBase64PrivateKey(base64: string): Buffer {
  return Buffer.from(base64, "base64");
}

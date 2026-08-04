// Configuración de Google Wallet — SOLO SERVIDOR.
// Nunca importar esto desde código que llegue al bundle del cliente: contiene
// (o lee) la clave privada de la service account, que es un SECRETO.
//
// Fuentes de las variables:
//   - Local (vite dev / node): process.env (usa un .env o variables del shell).
//   - Cloudflare Workers: setear como *secrets* de runtime
//       (wrangler secret put GOOGLE_WALLET_SA_PRIVATE_KEY, etc.)
//     Con nodejs_compat, Nitro las expone en process.env.
//
// Si falta cualquiera de las tres, corremos en modo "mock": el flujo completo
// funciona en la app pero NO se emite un pase real de Google Wallet. Así se puede
// desarrollar y demostrar sin credenciales; en cuanto se configuren, pasa a live.

export type WalletConfig =
  | {
      mode: "live";
      issuerId: string;
      serviceAccountEmail: string;
      privateKeyPem: string;
      origin: string; // origen público de la app (para el link de save)
    }
  | { mode: "mock"; issuerId: string; origin: string };

function env(name: string): string | undefined {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[name];
  return v && v.trim() !== "" ? v : undefined;
}

export function getWalletConfig(): WalletConfig {
  const issuerId = env("GOOGLE_WALLET_ISSUER_ID") ?? "3388000000000000000"; // demo issuer id
  const origin = env("PUBLIC_APP_ORIGIN") ?? "http://localhost:8080";
  const serviceAccountEmail = env("GOOGLE_WALLET_SA_EMAIL");
  // La private key en env suele venir con "\n" escapados: los normalizamos.
  const privateKeyPem = env("GOOGLE_WALLET_SA_PRIVATE_KEY")?.replace(/\\n/g, "\n");

  if (serviceAccountEmail && privateKeyPem && env("GOOGLE_WALLET_ISSUER_ID")) {
    return { mode: "live", issuerId, serviceAccountEmail, privateKeyPem, origin };
  }
  return { mode: "mock", issuerId, origin };
}

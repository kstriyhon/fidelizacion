// Valida las credenciales de Google Wallet de punta a punta:
//  1) firma un JWT y obtiene un access token OAuth (service account)
//  2) crea/actualiza una LoyaltyClass real (la plantilla de la tarjeta)
//  3) crea/actualiza un LoyaltyObject real (una tarjeta de prueba con sellos)
//  4) imprime un enlace "Añadir a Google Wallet" que puedes abrir en tu Android
//
// Uso:  node scripts/validate-wallet.mjs
// Lee ./google-wallet-sa.json (gitignored). No expone la clave privada.

import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const ISSUER_ID = process.env.GOOGLE_WALLET_ISSUER_ID || "3388000000023178109";
const ORIGIN = process.env.PUBLIC_APP_ORIGIN || "http://localhost:8080";
const WOBJ = "https://walletobjects.googleapis.com/walletobjects/v1";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

const sa = JSON.parse(readFileSync(new URL("../google-wallet-sa.json", import.meta.url)));

function b64url(x) {
  return Buffer.from(x).toString("base64url");
}
function signRs256(claims, pem) {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const data = `${head}.${body}`;
  const sig = crypto.createSign("RSA-SHA256").update(data).sign(pem);
  return `${data}.${Buffer.from(sig).toString("base64url")}`;
}

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const assertion = signRs256(
    {
      iss: sa.client_email,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
  );
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${text}`);
  return JSON.parse(text).access_token;
}

async function api(token, method, path, body) {
  const res = await fetch(`${WOBJ}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, text: await res.text() };
}

async function upsert(token, kind, id, payload) {
  const get = await api(token, "GET", `/${kind}/${id}`);
  if (get.status === 404) {
    const c = await api(token, "POST", `/${kind}`, payload);
    if (c.status >= 300) throw new Error(`crear ${kind} ${c.status}: ${c.text}`);
    return "creado";
  }
  if (get.status < 300) {
    const u = await api(token, "PUT", `/${kind}/${id}`, payload);
    if (u.status >= 300) throw new Error(`actualizar ${kind} ${u.status}: ${u.text}`);
    return "actualizado";
  }
  throw new Error(`get ${kind} ${get.status}: ${get.text}`);
}

async function main() {
  console.log("→ Issuer:", ISSUER_ID, "| SA:", sa.client_email);
  const token = await getToken();
  console.log("✓ Access token OK (OAuth con la service account funciona)");

  const classId = `${ISSUER_ID}.cafe_central`;
  const objectId = `${ISSUER_ID}.demo_maria`;

  const LOGO = "https://placehold.co/600x600/7c3aed/ffffff/png";
  const classPayload = {
    id: classId,
    issuerName: "Café Central",
    programName: "Tarjeta de café",
    reviewStatus: "UNDER_REVIEW",
    hexBackgroundColor: "#7c3aed",
    programLogo: {
      sourceUri: { uri: LOGO },
      contentDescription: { defaultValue: { language: "es", value: "Café Central" } },
    },
    textModulesData: [{ id: "reward", header: "Premio", body: "10 sellos = Un café gratis" }],
  };
  console.log("→ LoyaltyClass:", await upsert(token, "loyaltyClass", classId, classPayload));

  const objectPayload = {
    id: objectId,
    classId,
    state: "ACTIVE",
    accountName: "María López",
    accountId: "demo-maria",
    loyaltyPoints: { label: "Sellos", balance: { string: "1/10" } },
    barcode: { type: "QR_CODE", value: "demo-maria", alternateText: "María López" },
    textModulesData: [{ id: "reward", header: "Premio", body: "10 sellos = Un café gratis" }],
  };
  console.log("→ LoyaltyObject:", await upsert(token, "loyaltyObject", objectId, objectPayload));

  const now = Math.floor(Date.now() / 1000);
  const saveJwt = signRs256(
    {
      iss: sa.client_email,
      aud: "google",
      typ: "savetowallet",
      iat: now,
      origins: [ORIGIN],
      payload: { loyaltyObjects: [{ id: objectId, classId }] },
    },
    sa.private_key,
  );

  console.log("\n✅ TODO OK. Abre este enlace en tu Android (misma cuenta Google):\n");
  console.log(`https://pay.google.com/gp/v/save/${saveJwt}\n`);
}

main().catch((e) => {
  console.error("\n✗ ERROR:", e.message);
  if (String(e.message).includes("403")) {
    console.error(
      "\n⚠ 403 = la service account no está autorizada como emisor.\n" +
        "  Ve a Google Pay & Wallet Console → Usuarios → agrega\n  " +
        sa.client_email +
        " con rol Editor, y reintenta.",
    );
  }
  process.exit(1);
});

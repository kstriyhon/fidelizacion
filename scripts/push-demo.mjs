// Prueba de PUSH: actualiza el saldo de sellos del pase de demo y envía un
// mensaje. Ambas cosas disparan una notificación en el celular que tiene el pase.
//
// Uso:  node scripts/push-demo.mjs [nuevoSaldo]     (por defecto 2)

import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const ISSUER_ID = process.env.GOOGLE_WALLET_ISSUER_ID || "3388000000023178109";
const WOBJ = "https://walletobjects.googleapis.com/walletobjects/v1";
const sa = JSON.parse(readFileSync(new URL("../google-wallet-sa.json", import.meta.url)));
const objectId = `${ISSUER_ID}.demo_maria`;
const nuevo = Number(process.argv[2] || 2);

const b64url = (x) => Buffer.from(x).toString("base64url");
function signRs256(claims, pem) {
  const data = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  return `${data}.${crypto.createSign("RSA-SHA256").update(data).sign(pem).toString("base64url")}`;
}
async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const assertion = signRs256(
    {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/wallet_object.issuer",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
  );
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!r.ok) throw new Error(`OAuth ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}
async function api(token, method, path, body) {
  const r = await fetch(`${WOBJ}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, text: await r.text() };
}

const token = await getToken();
const patch = await api(token, "PATCH", `/loyaltyObject/${objectId}`, {
  loyaltyPoints: { label: "Sellos", balance: { string: `${nuevo}/10` } },
});
console.log("PATCH saldo:", patch.status < 300 ? `OK → ${nuevo}/10` : patch.text);

const msg = await api(token, "POST", `/loyaltyObject/${objectId}/addMessage`, {
  message: {
    id: `m_${Date.now()}`,
    header: "¡Nuevo sello! ☕",
    body: `Vas ${nuevo}/10 en Café Central. ¡Te faltan ${10 - nuevo} para tu café gratis!`,
    // TEXT_AND_NOTIFY = además de mostrarse en el pase, dispara notificación push.
    messageType: "TEXT_AND_NOTIFY",
  },
});
console.log("addMessage:", msg.status < 300 ? "OK (push TEXT_AND_NOTIFY enviado)" : msg.text);

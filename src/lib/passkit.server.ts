// PassKit Web Service — SOLO SERVIDOR.
// Interceptado directamente en src/server.ts (antes de delegar al handler de
// TanStack Start) porque esta versión de TanStack Start no expone un mecanismo
// de "API routes" de archivo — usamos fetch/Request/Response estándar, que
// funciona igual en `vite dev` y en Cloudflare Workers.
//
// Rutas:
//   GET    /api/passkit/download/:serial?t=authToken
//     Descarga inicial del .pkpass (la abre el navegador o Wallet). Sin el
//     header especial "Authorization: ApplePass ..." — ese es solo para las
//     rutas de abajo, que las llama el propio dispositivo tras instalar el pase.
//   POST   /api/passkit/v1/passes/:passType/:serial/devices/:deviceId
//   DELETE /api/passkit/v1/passes/:passType/:serial/devices/:deviceId
//   GET    /api/passkit/v1/passes/:passType/:serial
//   GET    /api/passkit/v1/log
//
// Documentación: https://developer.apple.com/library/archive/documentation/PassKit/Conceptual/PassKit_Developer_Guide/PassKit_WEB_Service/PassKit_WEB_Service.html

import { getSupabaseAdmin } from "./supabaseAdmin.server";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function extractAuthToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const parts = authorization.split(" ");
  if (parts.length !== 2 || parts[0] !== "ApplePass") return null;
  return parts[1];
}

/** true si la ruta es de PassKit y este módulo debe manejarla. */
export function isPassKitRequest(pathname: string): boolean {
  return pathname.startsWith("/api/passkit/");
}

export async function handlePassKitRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["api","passkit", ...]
  const db = getSupabaseAdmin();

  // GET /api/passkit/download/:serial?t=authToken
  if (request.method === "GET" && parts[2] === "download" && parts[3]) {
    const serial = parts[3];
    const token = url.searchParams.get("t");
    if (!token) return json({ error: "Missing token" }, 401);

    const { data: applePass, error } = await db
      .from("loyalty_apple_passes")
      .select("signature, auth_token")
      .eq("serial_number", serial)
      .single();

    if (error || !applePass) return json({ error: "Pass not found" }, 404);
    if (applePass.auth_token !== token) return json({ error: "Unauthorized" }, 401);

    const bytes = decodeBytea(applePass.signature);
    if (!bytes || bytes.length === 0) {
      return json({ error: "Pass not available (mock mode or not yet generated)" }, 404);
    }

    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/vnd.apple.pkpass",
        "content-disposition": `attachment; filename="pass.pkpass"`,
      },
    });
  }

  // /api/passkit/v1/passes/{passType}/{serialNumber}[/devices/{deviceId}]
  if (parts[2] === "v1" && parts[3] === "passes" && parts[4] && parts[5]) {
    const passType = parts[4];
    const serialNumber = parts[5];
    const isDeviceRoute = parts[6] === "devices" && parts[7];
    const deviceId = parts[7];

    const authToken = extractAuthToken(request.headers.get("authorization"));
    if (!authToken) return json({ error: "Unauthorized" }, 401);

    const { data: applePass, error } = await db
      .from("loyalty_apple_passes")
      .select("id, member_id, auth_token, signature")
      .eq("pass_type_id", passType)
      .eq("serial_number", serialNumber)
      .single();

    if (error || !applePass || applePass.auth_token !== authToken) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (isDeviceRoute && request.method === "POST") {
      let pushToken = "";
      try {
        const body = (await request.json()) as { pushToken?: string };
        pushToken = body.pushToken ?? "";
      } catch {
        // sin body válido, continuar con pushToken vacío
      }

      const { error: upsertError } = await db.from("loyalty_device_registrations").upsert(
        {
          member_id: applePass.member_id,
          device_library_identifier: deviceId,
          push_token: pushToken,
          registered_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "member_id,device_library_identifier" },
      );

      if (upsertError) return json({ error: "Failed to register device" }, 500);
      return json({ success: true }, 201);
    }

    if (isDeviceRoute && request.method === "DELETE") {
      const { error: deleteError } = await db
        .from("loyalty_device_registrations")
        .delete()
        .eq("member_id", applePass.member_id)
        .eq("device_library_identifier", deviceId);

      if (deleteError) return json({ error: "Failed to delete device" }, 500);
      return new Response(null, { status: 204 });
    }

    if (!isDeviceRoute && request.method === "GET") {
      const bytes = decodeBytea(applePass.signature);
      if (!bytes || bytes.length === 0) return json({ error: "Pass not available" }, 404);
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "application/vnd.apple.pkpass",
          "content-disposition": `attachment; filename="pass.pkpass"`,
        },
      });
    }
  }

  // GET /api/passkit/v1/log
  if (parts[2] === "v1" && parts[3] === "log") {
    try {
      const logs = await request.json();
      console.log("Apple Wallet client error logs:", logs);
    } catch {
      // ignorar body inválido
    }
    return json({ success: true }, 200);
  }

  return json({ error: "Not found" }, 404);
}

/**
 * PostgREST devuelve columnas bytea como string hex "\\x..." (o a veces ya
 * como Buffer/Uint8Array según el cliente). Normaliza a Buffer.
 */
function decodeBytea(value: unknown): Buffer | null {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
    return Buffer.from(value, "base64");
  }
  return null;
}

// PassKit Web Service endpoints para Apple Wallet
// Estos endpoints son llamados por Apple cuando:
// 1. Un cliente registra un dispositivo en Wallet (POST /devices)
// 2. Un cliente desregistra un dispositivo (DELETE /devices)
// 3. Apple necesita obtener una versión actualizada del pase (GET /passes)
//
// Documentación: https://developer.apple.com/library/archive/documentation/PassKit/Conceptual/PassKit_Developer_Guide/PassKit_WEB_Service/PassKit_WEB_Service.html

import { json, type EventHandler } from "@tanstack/start";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin.server";

// Validación de Authorization header
function extractAuthToken(authorization?: string): string | null {
  if (!authorization) return null;
  const parts = authorization.split(" ");
  if (parts.length !== 2 || parts[0] !== "ApplePass") return null;
  return parts[1];
}

// --- POST /api/passkit/v1/passes/{passType}/{serialNumber}/devices/{deviceId} ---
// Apple registra un dispositivo para recibir notificaciones del pase

export const postDeviceRegistration: EventHandler = async (event) => {
  try {
    const url = new URL(event.node.req.url || "");
    const parts = url.pathname.split("/");

    // Parsear URL: /api/passkit/v1/passes/{passType}/{serialNumber}/devices/{deviceId}
    const passType = parts[4];
    const serialNumber = parts[5];
    const deviceId = parts[7]; // device library identifier

    if (!passType || !serialNumber || !deviceId) {
      return json({ error: "Invalid path parameters" }, { status: 400 });
    }

    // Obtener el token del header Authorization
    const authorization = event.node.req.headers.get("authorization");
    const authToken = extractAuthToken(authorization);

    if (!authToken) {
      return json({ error: "Unauthorized: Missing or invalid Authorization header" }, { status: 401 });
    }

    // Leer el body del request (contiene deviceLibraryIdentifier, pushToken, etc.)
    let body: any = {};
    try {
      const text = await event.node.req.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      // Si no hay body o no es JSON válido, continuar
    }

    const pushToken = body.pushToken || ""; // Apple proporciona el token en el request

    // 1. Verificar que el pase existe en nuestra base de datos
    const db = getSupabaseAdmin();

    const { data: applePass, error: passError } = await db
      .from("loyalty_apple_passes")
      .select("id, member_id, auth_token")
      .eq("pass_type_id", passType)
      .eq("serial_number", serialNumber)
      .single();

    if (passError || !applePass) {
      return json({ error: "Pass not found" }, { status: 404 });
    }

    // 2. Validar el auth_token (verificar que el cliente tiene derecho a registrar este dispositivo)
    if (applePass.auth_token !== authToken) {
      return json({ error: "Unauthorized: Invalid auth token" }, { status: 401 });
    }

    // 3. Registrar o actualizar el dispositivo en la base de datos
    const { error: insertError } = await db.from("loyalty_device_registrations").upsert(
      {
        member_id: applePass.member_id,
        device_library_identifier: deviceId,
        push_token: pushToken,
        registered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "member_id, device_library_identifier",
      }
    );

    if (insertError) {
      console.error("Error registering device:", insertError);
      return json({ error: "Failed to register device" }, { status: 500 });
    }

    // Responder con 201 Created
    return json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Error in postDeviceRegistration:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

// --- DELETE /api/passkit/v1/passes/{passType}/{serialNumber}/devices/{deviceId} ---
// Apple desregistra un dispositivo (usuario removió el pase de Wallet)

export const deleteDeviceRegistration: EventHandler = async (event) => {
  try {
    const url = new URL(event.node.req.url || "");
    const parts = url.pathname.split("/");

    const passType = parts[4];
    const serialNumber = parts[5];
    const deviceId = parts[7];

    if (!passType || !serialNumber || !deviceId) {
      return json({ error: "Invalid path parameters" }, { status: 400 });
    }

    const authorization = event.node.req.headers.get("authorization");
    const authToken = extractAuthToken(authorization);

    if (!authToken) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getSupabaseAdmin();

    // 1. Verificar que el pase existe
    const { data: applePass, error: passError } = await db
      .from("loyalty_apple_passes")
      .select("id, member_id, auth_token")
      .eq("pass_type_id", passType)
      .eq("serial_number", serialNumber)
      .single();

    if (passError || !applePass || applePass.auth_token !== authToken) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Eliminar el registro del dispositivo
    const { error: deleteError } = await db
      .from("loyalty_device_registrations")
      .delete()
      .eq("member_id", applePass.member_id)
      .eq("device_library_identifier", deviceId);

    if (deleteError) {
      console.error("Error deleting device:", deleteError);
      return json({ error: "Failed to delete device" }, { status: 500 });
    }

    return json({}, { status: 204 });
  } catch (error) {
    console.error("Error in deleteDeviceRegistration:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

// --- GET /api/passkit/v1/passes/{passType}/{serialNumber} ---
// Apple obtiene la versión más reciente del pase (para actualizaciones)

export const getPass: EventHandler = async (event) => {
  try {
    const url = new URL(event.node.req.url || "");
    const parts = url.pathname.split("/");

    const passType = parts[4];
    const serialNumber = parts[5];

    if (!passType || !serialNumber) {
      return json({ error: "Invalid path parameters" }, { status: 400 });
    }

    const authorization = event.node.req.headers.get("authorization");
    const authToken = extractAuthToken(authorization);

    if (!authToken) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getSupabaseAdmin();

    // 1. Obtener el pase y su firma
    const { data: applePass, error: passError } = await db
      .from("loyalty_apple_passes")
      .select("id, signature, auth_token")
      .eq("pass_type_id", passType)
      .eq("serial_number", serialNumber)
      .single();

    if (passError || !applePass) {
      return json({ error: "Pass not found" }, { status: 404 });
    }

    if (applePass.auth_token !== authToken) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Retornar el archivo .pkpass (que fue guardado cuando se creó)
    // En producción, esto sería traído del storage (R2, etc.)
    // Por ahora, retornamos un placeholder
    // TODO: Implementar storage de .pkpass

    return new Response(Buffer.from(applePass.signature), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": `attachment; filename="pass.pkpass"`,
      },
    });
  } catch (error) {
    console.error("Error in getPass:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

// --- GET /api/passkit/v1/log ---
// Apple envía logs de errores del cliente (opcional)

export const getLog: EventHandler = async (event) => {
  try {
    const logs = await event.node.req.json();

    // Loguear errores del cliente de Apple Wallet
    console.log("Apple Wallet client error logs:", logs);

    // Procesar logs si es necesario (guardar en base de datos, alertar, etc.)

    return json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error in getLog:", error);
    // Apple espera 200 OK sin importar qué pase
    return json({}, { status: 200 });
  }
};

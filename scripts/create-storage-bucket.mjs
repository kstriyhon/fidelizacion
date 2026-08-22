#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

let SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  try {
    const devVars = readFileSync(".dev.vars", "utf-8");
    const match = devVars.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
    SERVICE_ROLE_KEY = match ? match[1].trim() : null;
  } catch (e) {}
}

const SUPABASE_URL = "https://zkecrbagxwewtubnusls.supabase.co";

if (!SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY no encontrada");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

console.log("🪣 Creando bucket 'logos'...\n");

const { data, error } = await db.storage.createBucket("logos", {
  public: true,
  fileSizeLimit: 5242880, // 5MB
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
});

if (error) {
  if (error.message.includes("already exists")) {
    console.log("✅ El bucket 'logos' ya existe");
  } else {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
} else {
  console.log("✅ Bucket 'logos' creado correctamente");
  console.log(`   ID: ${data.id}`);
  console.log(`   Público: sí`);
  console.log(`   Límite: 5MB`);
  console.log(`   Formatos: PNG, JPEG, WebP`);
}

// Ahora habilitar políticas de acceso público para que la app pueda subir
console.log("\n🔐 Configurando políticas de Storage...\n");

// Política para que cualquiera pueda leer (descarga de logos)
const { error: policyError1 } = await db.storage.from("logos").updateBucket({
  public: true,
});

if (policyError1) {
  console.error("⚠️  Error al configurar permisos:", policyError1.message);
} else {
  console.log("✅ Políticas configuradas");
  console.log("   • Lectura pública: habilitada");
  console.log("   • La app (con service_role) puede subir archivos");
}

console.log("\n🎉 Storage listo para logos");

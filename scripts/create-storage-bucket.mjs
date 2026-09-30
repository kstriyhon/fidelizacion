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

// La URL se lee de src/lib/supabaseCredentials.ts, que es la que usa la app.
// Antes estaba escrita a mano aquí y se quedó apuntando a un proyecto que ya no
// existe, así que el bucket se creó en el sitio equivocado y las subidas de
// logo fallaban con "Bucket not found".
const SUPABASE_URL = (() => {
  const src = readFileSync("src/lib/supabaseCredentials.ts", "utf-8");
  const m = src.match(/SUPABASE_URL\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("No se pudo leer SUPABASE_URL de src/lib/supabaseCredentials.ts");
  return m[1];
})();

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

// Aquí había una llamada a db.storage.from("logos").updateBucket(), que no
// existe en la librería y hacía reventar el script DESPUÉS de haber creado el
// bucket — dejando la impresión de que había fallado todo.
//
// No hace falta: el bucket ya se crea con public: true arriba, que es lo único
// que necesita getPublicUrl() para que el logo se vea en la tarjeta de Wallet.
// Las subidas van con service_role desde el servidor, que se salta las
// políticas por diseño.

// Comprobación real en vez de darlo por hecho.
const { data: buckets, error: listErr } = await db.storage.listBuckets();
if (listErr) {
  console.error("⚠️  No se pudo verificar:", listErr.message);
  process.exit(1);
}
const logos = buckets.find((b) => b.name === "logos");
if (!logos) {
  console.error("❌ El bucket 'logos' NO aparece tras crearlo.");
  process.exit(1);
}
console.log(`\n🎉 Verificado: bucket 'logos' existe, público=${logos.public}`);
console.log(`   Proyecto: ${SUPABASE_URL}`);

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

// Obtener todos los negocios
const { data: businesses } = await db
  .from("loyalty_businesses")
  .select("id, name, owner_id");

console.log("🏢 Negocios en la BD:");
for (const b of businesses || []) {
  const status = b.owner_id ? "✅" : "❌ (sin dueño)";
  console.log(`  ${status} ${b.name}`);
}

// Identificar cuáles son de prueba/sin dueño
const testBusinesses = (businesses || []).filter((b) => !b.owner_id || b.name.includes("Test"));

if (testBusinesses.length === 0) {
  console.log("\n✅ No hay negocios de prueba para limpiar");
  process.exit(0);
}

console.log(`\n🗑️  Negocios a eliminar: ${testBusinesses.length}`);
for (const b of testBusinesses) {
  console.log(`  ✗ ${b.name}${b.owner_id ? "" : " (sin dueño)"}`);
}

console.log("\n⚠️  Se va a ELIMINAR ${testBusinesses.length} negocio(s) y su datos (IRREVERSIBLE).");
console.log("Presiona Ctrl+C para cancelar...");
await new Promise((r) => setTimeout(r, 2000));

// Eliminar
const testIds = testBusinesses.map((b) => b.id);
const { error } = await db
  .from("loyalty_businesses")
  .delete()
  .in("id", testIds);

if (error) {
  console.error("❌ Error:", error.message);
  process.exit(1);
}

console.log(`\n✅ Eliminados ${testBusinesses.length} negocio(s) de prueba`);
console.log(`✅ Conservados: negocios con dueño real`);

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

// Obtener todos los miembros
const { data: allMembers } = await db
  .from("loyalty_members")
  .select("id, full_name");

// Filtrar los que son de prueba (NO es "Este si")
const testMembers = (allMembers || []).filter((m) => m.full_name !== "Este si");

console.log(`🗑️  Miembros a eliminar: ${testMembers.length}`);
console.log("\nLista de eliminación:");
for (const m of testMembers) {
  console.log(`  ✗ ${m.full_name}`);
}

console.log("\n⚠️  Se va a ELIMINAR ${testMembers.length} registros (IRREVERSIBLE).");
console.log("Presiona Ctrl+C para cancelar o ENTER para proceder...");

// Esperar confirmación
await new Promise((r) => setTimeout(r, 1000));

// Eliminar
const testMemberIds = testMembers.map((m) => m.id);

const { error } = await db.from("loyalty_members").delete().in("id", testMemberIds);

if (error) {
  console.error("❌ Error:", error.message);
  process.exit(1);
}

console.log(`\n✅ Eliminados ${testMembers.length} clientes de prueba`);
console.log(`✅ Retenido: "Este si" (cliente real para pruebas de iPhone)`);

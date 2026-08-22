#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Leer .dev.vars manualmente
let SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  try {
    const devVars = readFileSync(".dev.vars", "utf-8");
    const match = devVars.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
    SERVICE_ROLE_KEY = match ? match[1].trim() : null;
  } catch (e) {
    // ignorar
  }
}

const SUPABASE_URL = "https://zkecrbagxwewtubnusls.supabase.co";

if (!SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY no encontrada");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function analyzeTestData() {
  console.log("🔍 Analizando datos de prueba...\n");

  // Obtener todos los negocios
  const { data: businesses } = await db
    .from("loyalty_businesses")
    .select("id, name, owner_id, created_at");

  console.log(`📊 Total de negocios: ${businesses?.length ?? 0}\n`);

  // Por cada negocio, contar miembros
  for (const business of businesses || []) {
    const { data: members, count } = await db
      .from("loyalty_members")
      .select("*", { count: "exact" })
      .eq("business_id", business.id);

    const createdDate = new Date(business.created_at).toLocaleDateString("es-ES");

    console.log(`\n📦 Negocio: ${business.name}`);
    console.log(`   ID: ${business.id}`);
    console.log(`   Dueño: ${business.owner_id || "sin asignar"}`);
    console.log(`   Creado: ${createdDate}`);
    console.log(`   Clientes: ${count ?? 0}`);

    if (members && members.length > 0) {
      console.log(`   \n   Clientes en este negocio:`);
      for (const m of members.slice(0, 10)) {
        const displayName = `${m.name || "(sin nombre)"}`;
        const createdMemberDate = new Date(m.created_at).toLocaleDateString("es-ES");
        console.log(`     • ${displayName} (${createdMemberDate}) - ${m.email || m.phone || "sin contacto"}`);
      }
      if (members.length > 10) {
        console.log(`     ... y ${members.length - 10} más`);
      }
    }
  }

  // Contar total de miembros
  const { count: totalMembers } = await db
    .from("loyalty_members")
    .select("*", { count: "exact" });

  console.log(`\n\n📈 TOTAL DE CLIENTES EN LA BD: ${totalMembers ?? 0}`);
}

async function deleteTestMembers(namePattern) {
  console.log(`\n🗑️  Eliminando clientes que coinciden con patrón: "${namePattern}"\n`);

  const { data: toDelete } = await db
    .from("loyalty_members")
    .select("id, name, email, phone, business_id")
    .ilike("name", `%${namePattern}%`);

  if (!toDelete || toDelete.length === 0) {
    console.log("No se encontraron clientes con ese patrón");
    return;
  }

  console.log(`Encontrados ${toDelete.length} clientes:`);
  for (const m of toDelete) {
    console.log(`  • ${m.name} (${m.email || m.phone || "sin contacto"})`);
  }

  // Confirmar eliminación
  console.log(`\n⚠️  Se van a ELIMINAR ${toDelete.length} registros (IRREVERSIBLE).`);
  console.log("Presiona Ctrl+C para cancelar, o espera 3 segundos...\n");

  await new Promise((r) => setTimeout(r, 3000));

  const { error } = await db
    .from("loyalty_members")
    .delete()
    .in("id", toDelete.map((m) => m.id));

  if (error) {
    console.error("❌ Error al eliminar:", error.message);
  } else {
    console.log(`✅ Eliminados ${toDelete.length} clientes`);
  }
}

// Main
if (process.argv[2] === "--delete") {
  const pattern = process.argv[3] || "test";
  await deleteTestMembers(pattern);
} else {
  await analyzeTestData();
  console.log("\n\nPara eliminar clientes de prueba:");
  console.log("  npm run cleanup-test -- --delete <patrón>");
  console.log("\nEjemplos:");
  console.log("  npm run cleanup-test -- --delete test");
  console.log("  npm run cleanup-test -- --delete juan");
}

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

// Obtener todos los miembros sin filtro
const { data: allMembers, count } = await db
  .from("loyalty_members")
  .select("id, name, email, phone, business_id, created_at", { count: "exact" });

console.log(`📋 Total de miembros: ${count}\n`);

// Agrupar por business_id
const byBusiness = {};
for (const m of allMembers || []) {
  if (!byBusiness[m.business_id]) {
    byBusiness[m.business_id] = [];
  }
  byBusiness[m.business_id].push(m);
}

// Obtener nombres de negocios
for (const businessId of Object.keys(byBusiness)) {
  const { data: business } = await db
    .from("loyalty_businesses")
    .select("name")
    .eq("id", businessId)
    .single();

  const businessName = business?.name || `(ID: ${businessId})`;
  const members = byBusiness[businessId];

  console.log(`\n📦 ${businessName}: ${members.length} clientes`);
  for (const m of members.slice(0, 15)) {
    console.log(`   • ${m.name || "(sin nombre)"} — ${m.email || m.phone || "sin contacto"}`);
  }
  if (members.length > 15) {
    console.log(`   ... y ${members.length - 15} más`);
  }
}

console.log(`\n\nPara eliminar clientes de un negocio específico:`);
console.log(`  node scripts/delete-business-members.mjs <business_id>\n`);

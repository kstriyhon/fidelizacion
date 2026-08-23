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

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Buscar suplefit
const { data: business } = await db
  .from("loyalty_businesses")
  .select("id, name, owner_id, created_at")
  .eq("name", "suplefit")
  .single();

if (!business) {
  console.log("❌ No se encontró negocio 'suplefit'");
  process.exit(1);
}

console.log("✅ Negocio encontrado:");
console.log(`   Nombre: ${business.name}`);
console.log(`   ID: ${business.id}`);
console.log(`   Owner ID: ${business.owner_id || "sin asignar"}`);

// Si tiene owner_id, buscar el usuario
if (business.owner_id) {
  const { data: user } = await db.auth.admin.getUserById(business.owner_id);
  if (user) {
    console.log(`   Email del dueño: ${user.email}`);
  }
}

// Contar programa y clientes
const { data: programs } = await db
  .from("loyalty_programs")
  .select("id, name, stamps_required, reward_description")
  .eq("business_id", business.id);

console.log(`\n📋 Programas: ${programs?.length ?? 0}`);
for (const p of programs || []) {
  console.log(`   • ${p.name} (${p.stamps_required} sellos = ${p.reward_description})`);
}

// Contar miembros
const { count } = await db
  .from("loyalty_members")
  .select("*", { count: "exact" })
  .in(
    "program_id",
    (programs || []).map((p) => p.id)
  );

console.log(`\n👥 Clientes totales: ${count ?? 0}`);

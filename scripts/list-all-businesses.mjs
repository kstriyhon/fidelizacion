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

const SUPABASE_URL = "https://mpckcsfumfznziqrhrxai.supabase.co";
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Listar todos los negocios
const { data: businesses } = await db
  .from("loyalty_businesses")
  .select("id, name, slug, created_at, status");

console.log("📋 Todos los negocios en Supabase:");
if (businesses && businesses.length > 0) {
  businesses.forEach((b) => {
    console.log(`   • ${b.name} (slug: ${b.slug}, status: ${b.status})`);
    console.log(`     ID: ${b.id}`);
    console.log(`     Creado: ${b.created_at}`);
  });
} else {
  console.log("   ❌ No hay negocios");
}

// Contar programas y miembros totales
const { count: programCount } = await db
  .from("loyalty_programs")
  .select("*", { count: "exact" });

const { count: memberCount } = await db
  .from("loyalty_members")
  .select("*", { count: "exact" });

console.log(`\n📊 Totales:`);
console.log(`   Negocios: ${businesses?.length ?? 0}`);
console.log(`   Programas: ${programCount ?? 0}`);
console.log(`   Clientes: ${memberCount ?? 0}`);

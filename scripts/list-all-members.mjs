#!/usr/bin/env node

// Lista todos los clientes agrupados por negocio.
//
// Ojo con el esquema: loyalty_members NO tiene business_id. Cuelga de
// program_id, y es el programa el que pertenece a un negocio:
//   loyalty_members.program_id -> loyalty_programs.business_id -> loyalty_businesses
//
// Este script pedía antes las columnas `name` y `business_id`, que no existen
// en esa tabla (son `full_name` y nada), así que la consulta fallaba y
// mostraba "Total: null" sin decir por qué.

import { db as conectar, anunciarProyecto } from "./_supabase.mjs";
const db = conectar();
anunciarProyecto();

const { data: members, count, error } = await db
  .from("loyalty_members")
  .select("id, full_name, email, phone, program_id, enrolled_at", { count: "exact" })
  .order("enrolled_at", { ascending: false });

if (error) {
  console.error("❌ Error al consultar clientes:", error.message);
  process.exit(1);
}

console.log(`📋 Total de clientes: ${count}\n`);

// Programa -> negocio, en una sola consulta en vez de una por cliente.
const { data: programs } = await db.from("loyalty_programs").select("id, name, business_id");
const { data: businesses } = await db.from("loyalty_businesses").select("id, name");

const negocioDePrograma = new Map();
for (const p of programs ?? []) {
  const negocio = (businesses ?? []).find((b) => b.id === p.business_id);
  negocioDePrograma.set(p.id, negocio?.name ?? `(negocio ${p.business_id})`);
}

const porNegocio = new Map();
for (const m of members ?? []) {
  const negocio = negocioDePrograma.get(m.program_id) ?? "(programa desconocido)";
  if (!porNegocio.has(negocio)) porNegocio.set(negocio, []);
  porNegocio.get(negocio).push(m);
}

if (porNegocio.size === 0) {
  console.log("   (sin clientes inscritos)");
}

for (const [negocio, lista] of porNegocio) {
  console.log(`\n📦 ${negocio}: ${lista.length} cliente(s)`);
  for (const m of lista.slice(0, 15)) {
    const contacto = m.phone || m.email || "sin contacto";
    console.log(`   • ${m.full_name || "(sin nombre)"} — ${contacto}`);
  }
  if (lista.length > 15) console.log(`   ... y ${lista.length - 15} más`);
}

console.log("");

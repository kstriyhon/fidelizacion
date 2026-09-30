#!/usr/bin/env node




import { db as conectar, anunciarProyecto } from "./_supabase.mjs";
const db = conectar();
anunciarProyecto();

// Query simple
const { data, error, count } = await db
  .from("loyalty_members")
  .select("id, full_name, program_id, enrolled_at", { count: "exact" })
  .limit(100);

console.log("Error:", error);
console.log("Count:", count);
console.log("Data length:", data?.length);
console.log("\nMiembros:");
for (const m of data || []) {
  const enrolled = new Date(m.enrolled_at).toLocaleDateString("es-ES");
  console.log(`  ${m.full_name || "(sin nombre)"} - ${enrolled}`);
}

#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

// Proyecto viejo
const OLD_SUPABASE_URL = "https://zkecrbagxwewtubnusls.supabase.co";
const OLD_SERVICE_ROLE_KEY = process.env.OLD_SUPABASE_SERVICE_ROLE_KEY || ""; // Necesitaremos esta clave

const db = createClient(OLD_SUPABASE_URL, OLD_SERVICE_ROLE_KEY || "");

console.log("🔍 Verificando proyecto viejo de Supabase...");
console.log(`   URL: ${OLD_SUPABASE_URL}`);

try {
  // Listar negocios
  const { data: businesses, error } = await db
    .from("loyalty_businesses")
    .select("id, name, slug, status");

  if (error) {
    console.log("❌ Error al conectar:", error.message);
    console.log("   (Puede que necesites la clave de servicio del proyecto viejo)");
    process.exit(1);
  }

  console.log(`\n✅ Negocios en proyecto viejo:`);
  if (businesses && businesses.length > 0) {
    businesses.forEach((b) => {
      console.log(`   • ${b.name} (slug: ${b.slug})`);
    });
  } else {
    console.log("   (vacío)");
  }

  // Buscar suplefit específicamente
  const { data: suplefit } = await db
    .from("loyalty_businesses")
    .select("*")
    .eq("name", "suplefit")
    .single();

  if (suplefit) {
    console.log(`\n✅ Encontrado: suplefit`);
    console.log(`   ID: ${suplefit.id}`);

    // Programas de suplefit
    const { data: programs } = await db
      .from("loyalty_programs")
      .select("id, name, active")
      .eq("business_id", suplefit.id);

    console.log(`   Programas: ${programs?.length ?? 0}`);
    programs?.forEach((p) => {
      console.log(`     • ${p.name} (active: ${p.active})`);
    });

    // Clientes inscritos en el evento del 30 de agosto
    if (programs && programs.length > 0) {
      const { data: members } = await db
        .from("loyalty_members")
        .select("full_name, enrolled_at, stamps")
        .in(
          "program_id",
          programs.map((p) => p.id)
        )
        .gte("enrolled_at", "2026-08-30T00:00:00")
        .lt("enrolled_at", "2026-08-31T00:00:00");

      console.log(`\n   Inscritos el 30 de agosto: ${members?.length ?? 0}`);
      members?.forEach((m) => {
        console.log(`     • ${m.full_name} (${m.stamps} sellos)`);
      });
    }
  } else {
    console.log("\n❌ No encontrado: suplefit");
  }
} catch (err) {
  console.error("Error:", err.message);
}

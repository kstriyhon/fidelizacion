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

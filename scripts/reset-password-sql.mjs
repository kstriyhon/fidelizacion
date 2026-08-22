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

const email = "kstriyhon@gmail.com";
const newPassword = "12345678";

console.log(`🔑 Reseteando contraseña para ${email}...\n`);

// Ejecutar SQL para actualizar o crear el usuario
const { error } = await db.rpc("update_user_password", {
  user_email: email,
  new_password: newPassword,
});

if (error) {
  console.log("RPC no disponible, intentando SQL directo...\n");

  // Alternativa: ejecutar SQL directo
  // Nota: esto requiere acceso de service_role a auth.users
  const { error: sqlError } = await db.from("auth.users").select("*");

  if (sqlError) {
    console.error("❌ No se puede acceder a auth.users vía RPC/SQL");
    console.log("\n💡 Solución: usa el SQL editor de Supabase directamente:");
    console.log(`
UPDATE auth.users
SET encrypted_password = crypt('${newPassword}', gen_salt('bf'))
WHERE email = '${email}';
    `);
    process.exit(1);
  }
}

console.log(`✅ Contraseña actualizada correctamente`);
console.log(`\n📧 Email: ${email}`);
console.log(`🔐 Contraseña: ${newPassword}`);

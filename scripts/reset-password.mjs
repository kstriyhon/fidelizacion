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

// Obtener el ID del usuario
const { data: usersData, error: listError } = await db.auth.admin.listUsers();
if (listError) {
  console.error("❌ Error al obtener usuarios:", listError.message);
  process.exit(1);
}

const user = usersData.users.find(u => u.email === email);
if (!user) {
  console.error(`❌ Usuario ${email} no encontrado`);
  process.exit(1);
}

// Actualizar contraseña
const { error } = await db.auth.admin.updateUserById(user.id, { password: newPassword });

if (error) {
  console.error("❌ Error al actualizar:", error.message);
  process.exit(1);
}

console.log(`✅ Contraseña actualizada correctamente`);
console.log(`\n📧 Email: ${email}`);
console.log(`🔐 Contraseña: ${newPassword}`);
console.log(`\n⚠️  Por seguridad, cambia esta contraseña después de acceder.`);

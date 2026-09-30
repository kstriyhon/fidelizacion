#!/usr/bin/env node





import { db as conectar, anunciarProyecto } from "./_supabase.mjs";
const db = conectar();
anunciarProyecto();

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

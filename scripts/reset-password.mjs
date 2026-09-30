#!/usr/bin/env node





import { db as conectar, anunciarProyecto } from "./_supabase.mjs";
const db = conectar();
anunciarProyecto();

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

#!/usr/bin/env node





import { db as conectar, anunciarProyecto } from "./_supabase.mjs";
const db = conectar();
anunciarProyecto();

const email = "kstriyhon@gmail.com";
const password = "12345678";

console.log(`🔑 Creando usuario ${email}...\n`);

const { data, error } = await db.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (error) {
  if (error.message.includes("already exists")) {
    console.log("✅ El usuario ya existe");
  } else {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
} else {
  console.log(`✅ Usuario creado correctamente`);
  console.log(`\n📧 Email: ${data.user?.email}`);
  console.log(`🆔 ID: ${data.user?.id}`);
}

// Verificar que suplefit esté asignado a este usuario
const userId = data?.user?.id;
if (userId) {
  const { data: business, error: updateError } = await db
    .from("loyalty_businesses")
    .update({ owner_id: userId })
    .eq("name", "suplefit")
    .select();

  if (updateError) {
    console.error("❌ Error al asignar owner:", updateError.message);
  } else {
    console.log(`\n✅ suplefit ahora es propiedad de ${email}`);
  }
}

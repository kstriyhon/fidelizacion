#!/usr/bin/env node
/**
 * Script para ejecutar la migración 0008_apple_wallet.sql en Supabase
 * Usa el Service Role Key para acceso full-admin
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Configuración
const PROJECT_ID = 'solasuxfnoipziijibam';
const SUPABASE_URL = `https://${PROJECT_ID}.supabase.co`;
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvbGFzdXhmbm9pcHppaWppYmFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTQyNTk2NSwiZXhwIjoyMTAxMDAxOTY1fQ.jABctsqOUpI37bgNChxlF4wyO4vGgyC08AXUns2wsco';

// Leer el archivo de migración
const migrationPath = path.resolve('./supabase/migrations/0008_apple_wallet.sql');
const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

console.log('🚀 Ejecutando migración 0008_apple_wallet.sql...\n');
console.log(`📦 Proyecto: ${PROJECT_ID}`);
console.log(`🔗 URL: ${SUPABASE_URL}\n`);

// Crear cliente de Supabase con service role (acceso full)
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Ejecutar migración
async function runMigration() {
  try {
    console.log('⏳ Ejecutando SQL...\n');

    // Ejecutar el SQL usando rpc para ejecutar queries raw
    // Nota: Supabase no expone un endpoint para queries raw, así que hacemos lo siguiente:
    // Dividimos el SQL en statements individuales y los ejecutamos uno por uno

    const statements = migrationSQL
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    console.log(`📝 Total de statements: ${statements.length}\n`);

    // Para ejecutar SQL raw en Supabase sin exposer un endpoint,
    // usamos un trigger o función. Pero lo más práctico es usar
    // el Cliente de Supabase con un RPC a una función personalizada.

    // ALTERNATIVA: Usar directamente la API de PostgreSQL
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql: migrationSQL }),
    });

    if (!response.ok) {
      // Si el RPC no existe, intentar alternativa
      throw new Error(`RPC exec_sql no disponible: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('✅ Migración ejecutada exitosamente!\n');
    console.log('📊 Resultado:', result);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error ejecutando migración:');
    console.error(error.message);

    // Alternativa: Sugerir usar el dashboard
    console.log('\n💡 ALTERNATIVA: Si el método automático no funciona,');
    console.log('   ejecuta el SQL manualmente en Supabase Dashboard:');
    console.log('   1. Ve a https://app.supabase.com');
    console.log('   2. Selecciona proyecto "solasuxfnoipziijibam"');
    console.log('   3. SQL Editor → New Query');
    console.log('   4. Copia el contenido de: supabase/migrations/0008_apple_wallet.sql');
    console.log('   5. Pega en el editor y haz click en "Run"\n');

    process.exit(1);
  }
}

runMigration();

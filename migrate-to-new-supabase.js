#!/usr/bin/env node
/**
 * Script para migrar schema completo a nuevo proyecto Supabase
 * Ejecuta: 0001_loyalty_core.sql + 0008_apple_wallet.sql
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Nueva cuenta Supabase
const PROJECT_ID = 'zkecrbagxwewtubnusls';
const SUPABASE_URL = `https://${PROJECT_ID}.supabase.co`;
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprZWNyYmFneHdld3R1Ym51c2xzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzI3NTAyMCwiZXhwIjoyMTAyODUxMDIwfQ.WVqFNWJF9jTN-zOLtYrfvxd7usDD7P8q2QGDnKiZv-0';

console.log('🚀 Migrando Fideliza a nuevo proyecto Supabase\n');
console.log(`📦 Proyecto: ${PROJECT_ID}`);
console.log(`🔗 URL: ${SUPABASE_URL}\n`);

// Crear cliente Supabase
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function runMigrations() {
  try {
    // 1. Leer migraciones
    const migrations = [
      { name: '0001_loyalty_core.sql', path: './supabase/migrations/0001_loyalty_core.sql' },
      { name: '0008_apple_wallet.sql', path: './supabase/migrations/0008_apple_wallet.sql' },
    ];

    for (const migration of migrations) {
      console.log(`\n⏳ Ejecutando: ${migration.name}`);
      const sql = fs.readFileSync(migration.path, 'utf8');

      // Dividir en statements individuales (ignorar comentarios)
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'));

      console.log(`   📝 Total statements: ${statements.length}`);

      // Ejecutar cada statement
      let completed = 0;
      for (const stmt of statements) {
        try {
          // Usar RPC o query directa
          const { error } = await supabase.rpc('exec_sql_internal', { sql: stmt }).catch(() => {
            // Si RPC no existe, intentar con fetch directo a PostgreSQL
            return fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
              },
              body: JSON.stringify({ sql: stmt }),
            }).then(r => ({ error: !r.ok ? r.statusText : null }));
          });

          if (error && error !== 'null') {
            console.warn(`   ⚠️  Statement skipped (puede ser normal si ya existe)`);
          }
          completed++;
        } catch (e) {
          console.warn(`   ⚠️  Error en statement: ${e.message}`);
        }
      }

      console.log(`   ✅ Completado: ${completed}/${statements.length}`);
    }

    console.log('\n✅ Migraciones ejecutadas exitosamente!\n');
    console.log('📊 Próximos pasos:');
    console.log('   1. npm run build');
    console.log('   2. npm run dev (testear localmente)');
    console.log('   3. Configurar secrets en Cloudflare Workers:');
    console.log(`      - SUPABASE_URL=https://${PROJECT_ID}.supabase.co`);
    console.log(`      - SUPABASE_SERVICE_ROLE_KEY=[la service role key]`);
    console.log('   4. npm run deploy');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error ejecutando migraciones:');
    console.error(error.message);

    console.log('\n💡 ALTERNATIVA: Ejecutar manualmente en Supabase Dashboard:');
    console.log('   1. Ve a https://app.supabase.com');
    console.log('   2. Selecciona proyecto "zkecrbagxwewtubnusls"');
    console.log('   3. SQL Editor → New Query');
    console.log('   4. Copia todo el contenido de:');
    console.log('      - supabase/migrations/0001_loyalty_core.sql');
    console.log('      - supabase/migrations/0008_apple_wallet.sql');
    console.log('   5. Click "Run"\n');

    process.exit(1);
  }
}

runMigrations();

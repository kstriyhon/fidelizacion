// Conexión compartida por los scripts de scripts/.
//
// Existe porque cada script tenía la URL del proyecto escrita a mano, y cuando
// se migró de proyecto Supabase todas quedaron apuntando a uno que ya no
// existe. Fallaban en silencio (o peor: parecían no hacer nada). Aquí la URL
// sale de src/lib/supabaseCredentials.ts, la misma fuente que usa la app, así
// que no puede volver a desincronizarse.
//
// Ejecutar siempre desde la raíz del repo: node scripts/<script>.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

export const SUPABASE_URL = (() => {
  const src = readFileSync("src/lib/supabaseCredentials.ts", "utf-8");
  const m = src.match(/SUPABASE_URL\s*=\s*"([^"]+)"/);
  if (!m) {
    throw new Error(
      "No se pudo leer SUPABASE_URL de src/lib/supabaseCredentials.ts. " +
        "¿Estás ejecutando desde la raíz del repo?",
    );
  }
  return m[1];
})();

export const SERVICE_ROLE_KEY = (() => {
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    const devVars = readFileSync(".dev.vars", "utf-8");
    const m = devVars.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
    if (m) return m[1].trim();
  } catch {
    /* sin .dev.vars */
  }
  console.error(
    "❌ Falta SUPABASE_SERVICE_ROLE_KEY (en el entorno o en .dev.vars de la raíz).",
  );
  process.exit(1);
})();

/** Cliente service_role. Omite RLS: cuidado con lo que se escribe. */
export function db() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Imprime contra qué proyecto se va a operar. Llámalo antes de tocar nada. */
export function anunciarProyecto() {
  console.log(`🗄️  Proyecto: ${SUPABASE_URL}\n`);
}

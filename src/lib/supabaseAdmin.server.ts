// Cliente Supabase con service_role — SOLO SERVIDOR. Omite la RLS.
// NUNCA importar desde código que llegue al cliente. La key se lee de env
// (SUPABASE_SERVICE_ROLE_KEY): en local desde .dev.vars (cargado por vite.config),
// en Cloudflare desde un *secret* de runtime.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./supabaseCredentials";

function env(name: string): string | undefined {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
    name
  ];
  return v && v.trim() !== "" ? v : undefined;
}

let cached: SupabaseClient | null = null;

/** Devuelve el cliente service-role. Lanza si falta la key (mala config). */
export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    throw new Error(
      "Falta SUPABASE_SERVICE_ROLE_KEY. Ponla en .dev.vars (local) o como secret en Cloudflare.",
    );
  }
  cached = createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Verifica un access_token de Supabase Auth y devuelve el usuario (o null). */
export async function getUserFromToken(
  token: string | undefined | null,
): Promise<{ id: string; email: string | null } | null> {
  if (!token) return null;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

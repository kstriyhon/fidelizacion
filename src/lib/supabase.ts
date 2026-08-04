import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseCredentials";

// Se usan SIEMPRE las credenciales públicas hardcodeadas de ./supabaseCredentials,
// sin leer import.meta.env.VITE_*. Motivo: en Cloudflare la variable de build
// VITE_SUPABASE_ANON_KEY quedó con un valor inválido que tenía prioridad y creaba
// el cliente con una key mala (fallaban todas las consultas). Hardcodear la anon
// key (pública por diseño; RLS protege los datos) elimina esa dependencia frágil.

export const isSupabaseConfigured = true;

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

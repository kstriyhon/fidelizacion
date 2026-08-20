// Auth de comercios con Supabase Auth (email + contraseña).
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/** Hook de sesión: null = sin sesión, undefined = cargando. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return session;
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  // Si el proyecto exige confirmación por email, no habrá sesión todavía.
  return { needsConfirmation: !data.session };
}

export async function signOut() {
  await supabase.auth.signOut();
}

/** Ruta a la que apunta el enlace del correo de recuperación. */
export const RECOVERY_PATH = "/nueva-clave";

/**
 * Envía el correo de recuperación. El enlace vuelve a RECOVERY_PATH de ESTE
 * origen, así que funciona igual en local y en producción — pero el origen debe
 * estar en la lista de "Redirect URLs" de Supabase o el enlace será rechazado.
 *
 * No revela si el correo existe: Supabase responde igual en ambos casos y la UI
 * muestra el mismo mensaje, para no filtrar qué cuentas hay registradas.
 */
export async function requestPasswordReset(email: string) {
  const redirectTo =
    typeof window !== "undefined" ? `${window.location.origin}${RECOVERY_PATH}` : undefined;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw new Error(error.message);
}

/** Fija una contraseña nueva. Requiere la sesión que crea el enlace del correo. */
export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

/** access_token de la sesión actual (para autorizar server functions). "" si no hay. */
export async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

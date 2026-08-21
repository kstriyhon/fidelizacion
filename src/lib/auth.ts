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
  // Sin emailRedirectTo, Supabase usa el "Site URL" configurado en el
  // dashboard del proyecto (Authentication → URL Configuration) para el link
  // del correo de confirmación — si ese Site URL quedó en localhost (default),
  // el link manda ahí sin importar desde dónde se registró el usuario. Con
  // esto, el link vuelve al origen real (local o producción), IGUAL que
  // requestPasswordReset — pero el origen también debe estar en la lista de
  // "Redirect URLs" del dashboard o Supabase lo rechaza.
  const emailRedirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo } });
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

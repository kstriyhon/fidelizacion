// Sesión de negocio en el navegador (la de /p/{slug}).
//
// Lo que se guarda aquí NO da acceso por sí mismo: el único campo que importa es
// `token`, firmado por el servidor. Los demás son para pintar la UI sin tener
// que pedirlos otra vez. Si alguien edita el businessId a mano en la consola, el
// servidor sigue usando el que va dentro del token, no este.

const KEY = "fideliza.business_session";

export type BusinessSession = {
  token: string;
  businessId: string;
  businessName: string;
  businessSlug: string;
  username: string;
};

export function saveBusinessSession(session: BusinessSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Modo incógnito o almacenamiento bloqueado: no es motivo para romper el login.
  }
}

export function getBusinessSession(): BusinessSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as BusinessSession;
    return typeof s?.token === "string" && s.token ? s : null;
  } catch {
    return null;
  }
}

export function clearBusinessSession(): void {
  try {
    localStorage.removeItem(KEY);
    // Restos del esquema anterior, anterior a que el login emitiera un token.
    localStorage.removeItem("business_session");
    localStorage.removeItem("selectedBusinessId");
  } catch {
    /* nada que hacer */
  }
}

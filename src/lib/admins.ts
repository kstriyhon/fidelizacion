// Correos con acceso de administrador (ven y gestionan TODOS los negocios).
// No es secreto (son solo emails); puede ir en el bundle del cliente.
export const ADMIN_EMAILS: string[] = ["idatech@protonmail.com", "kstriyhon@gmail.com"];

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  return ADMIN_EMAILS.map((x) => x.toLowerCase()).includes(e);
}

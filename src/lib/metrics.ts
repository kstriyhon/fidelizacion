// Métricas de fidelización calculadas desde los clientes (cliente-side).
import type { Member } from "./data";

const DAY = 86_400_000;

/** Última actividad del cliente: su último sello, o su fecha de inscripción. */
export function lastActivityMs(m: Member): number {
  return new Date(m.last_stamp_at ?? m.enrolled_at).getTime();
}

/** Cliente nuevo: inscrito dentro de los últimos `days` días. */
export function isNewMember(m: Member, days = 30, now = Date.now()): boolean {
  return now - new Date(m.enrolled_at).getTime() <= days * DAY;
}

/** Cliente inactivo: sin actividad en más de `days` días. */
export function isInactiveMember(m: Member, days: number, now = Date.now()): boolean {
  return now - lastActivityMs(m) > days * DAY;
}

export type Metrics = {
  total: number;
  nuevos: number;
  sellosDados: number;
  premios: number;
  inactivos: number;
  activos: number;
};

/**
 * Calcula métricas de un conjunto de clientes. `requiredFor` devuelve los sellos
 * requeridos del programa de cada cliente (para estimar sellos dados históricos).
 */
export function computeMetrics(
  members: Member[],
  requiredFor: (m: Member) => number,
  opts?: { inactiveDays?: number; newDays?: number },
): Metrics {
  const now = Date.now();
  const inactiveDays = opts?.inactiveDays ?? 30;
  const newDays = opts?.newDays ?? 30;
  let nuevos = 0;
  let sellosDados = 0;
  let premios = 0;
  let inactivos = 0;
  for (const m of members) {
    if (isNewMember(m, newDays, now)) nuevos++;
    premios += m.rewards_redeemed;
    // Sellos dados históricos ≈ los actuales + los de las tarjetas ya canjeadas.
    sellosDados += m.stamps + m.rewards_redeemed * requiredFor(m);
    if (isInactiveMember(m, inactiveDays, now)) inactivos++;
  }
  return {
    total: members.length,
    nuevos,
    sellosDados,
    premios,
    inactivos,
    activos: members.length - inactivos,
  };
}

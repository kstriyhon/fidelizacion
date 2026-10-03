// Niveles de fidelización del hotel: cálculo puro, sin base de datos ni red.
//
// Está aparte para poder probarlo de verdad. El nivel de un huésped es la clase
// de cosa que se mira una vez, se da por buena y luego resulta estar mal en el
// borde —el huésped que acaba de llegar al mínimo, el hotel que puso los
// niveles desordenados—, y esos bordes aquí se pueden comprobar uno a uno.

export type Nivel = {
  nombre: string;
  /** Estancias terminadas que hacen falta para estar en este nivel. */
  estancias: number;
  beneficio: string;
};

export type EstadoFidelizacion = {
  /** Estancias TERMINADAS. Las canceladas y las que están en curso no cuentan. */
  estancias: number;
  noches: number;
  /** Nivel actual, o null si todavía no llega al primero. */
  nivel: Nivel | null;
  /** Siguiente nivel al que puede subir, o null si ya está en el más alto. */
  siguiente: Nivel | null;
  /** Estancias que le faltan para el siguiente nivel. 0 si no hay siguiente. */
  faltan: number;
};

/**
 * Nivel de un huésped según sus estancias terminadas.
 *
 * Los niveles se ordenan aquí y no se confía en el orden en que vengan: los
 * escribe el hotel a mano en su panel, y basta que añada uno nuevo al final
 * para que la lista deje de estar ordenada. Si eso decidiera el nivel, un
 * huésped con diez estancias podría quedarse en el nivel más bajo.
 */
export function calcularNivel(
  estancias: number,
  noches: number,
  niveles: Nivel[],
): EstadoFidelizacion {
  const ordenados = [...niveles]
    .filter((n) => n && typeof n.nombre === "string" && n.nombre.trim() !== "")
    .sort((a, b) => (a.estancias ?? 0) - (b.estancias ?? 0));

  let nivel: Nivel | null = null;
  let siguiente: Nivel | null = null;

  for (const n of ordenados) {
    // >= y no >: quien pide "3 estancias" espera que a la tercera ya cuente.
    if (estancias >= (n.estancias ?? 0)) {
      nivel = n;
    } else {
      siguiente = n;
      break; // están ordenados: el primero que no alcanza es el siguiente
    }
  }

  return {
    estancias,
    noches,
    nivel,
    siguiente,
    faltan: siguiente ? Math.max(0, (siguiente.estancias ?? 0) - estancias) : 0,
  };
}

/**
 * Noches de una estancia.
 *
 * Se cuenta por DÍAS DE CALENDARIO y no por horas: una estancia de una noche
 * que entra a las 15:00 y sale a las 12:00 dura 21 horas, y dividir por 24
 * daría cero noches. Ningún hotel cobraría eso como cero.
 */
export function nochesDe(checkIn: string, checkOut: string): number {
  const dia = 24 * 60 * 60 * 1000;
  const entrada = new Date(checkIn);
  const salida = new Date(checkOut);
  const soloFecha = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const noches = Math.round((soloFecha(salida) - soloFecha(entrada)) / dia);
  // Entrada y salida el mismo día es una estancia de día, pero para el huésped
  // sigue siendo una visita: cuenta como una noche y no como ninguna.
  return Math.max(1, noches);
}

/** Suma las estancias terminadas de un huésped. */
export function resumirEstancias(
  reservas: Array<{ status: string; check_in: string; check_out: string }>,
): { estancias: number; noches: number } {
  const terminadas = reservas.filter((r) => r.status === "finalizada");
  return {
    estancias: terminadas.length,
    noches: terminadas.reduce((t, r) => t + nochesDe(r.check_in, r.check_out), 0),
  };
}

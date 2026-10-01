/**
 * Representación visual de los sellos para los pases de Wallet: ●●●○○○○○○○
 *
 * Por qué círculos de texto y no una imagen: generar un PNG por cliente y por
 * sello obligaría a crear la imagen, subirla a Storage y refrescarla en cada
 * visita — tres piezas nuevas que pueden fallar, en Cloudflare Workers, donde
 * además no hay librería de imágenes. Una cadena de texto se actualiza con el
 * mismo PATCH que ya manda el saldo y no añade nada que mantener.
 *
 * Se usa en los dos pases (Google y Apple) para que el cliente vea lo mismo
 * tenga el móvil que tenga.
 */

/** Más de esto y la fila de círculos no se lee de un vistazo en el pase. */
const MAXIMO_LEGIBLE = 12;

/**
 * Devuelve algo como "●●●○○○○○○○", o null si el programa tiene demasiados
 * sellos para dibujarlos. Quien llama debe omitir el campo cuando sea null, en
 * vez de pintar una fila ilegible: el saldo "18/30" sigue estando y es preciso.
 */
export function stampDots(stamps: number, required: number): string | null {
  if (!Number.isInteger(required) || required < 1 || required > MAXIMO_LEGIBLE) return null;
  // El contador podría venir fuera de rango por una corrección manual; se acota
  // para no repetir un número negativo de veces ni pasarse del total.
  const llenos = Math.max(0, Math.min(stamps, required));
  return "●".repeat(llenos) + "○".repeat(required - llenos);
}

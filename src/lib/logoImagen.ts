// Normaliza el logo que sube un comercio ANTES de mandarlo al servidor.
//
// Por qué aquí y no en el servidor: redimensionar necesita decodificar la
// imagen, y en producción corremos sobre Cloudflare Workers, donde no hay
// librerías nativas de imagen (sharp no arranca) y la transformación de
// imágenes de Supabase está deshabilitada en este plan. El navegador, en
// cambio, ya sabe hacerlo con un canvas.
//
// Qué resuelve, que no es cosmético:
//   - Apple SOLO admite PNG dentro del .pkpass. Un JPEG colado como icon.png
//     no da error al firmar: el pase se instala y la imagen sale rota.
//   - El logo va DOS veces dentro del .pkpass (icon.png y logo.png), y ese
//     archivo se guarda entero en la base y se refirma en cada cambio. Un logo
//     de 640x640 hacía un pase de 190 KB para pintarse a menos de 90 puntos.

/**
 * Lados a probar, de mejor a peor.
 *
 * 320 queda holgado por encima de todo lo que se llega a ver: Apple pinta el
 * icono a 87 px como mucho y la cabecera a 150; Google y la web, menos.
 *
 * Se baja cuando no cabe porque PNG es SIN PÉRDIDA: un logo que en realidad es
 * una foto —pasa, y uno de los comercios tiene justo eso— ocupa a 320 px más
 * que el JPEG original entero. Y como dentro del pase va dos veces, se paga
 * doble.
 */
const LADOS = [320, 224, 160];

/** Por encima de esto se reintenta más pequeño. Cuenta doble dentro del .pkpass. */
const MAXIMO_BYTES = 60 * 1024;

export type LogoNormalizado = {
  dataBase64: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  /** false si hubo que mandar el archivo original tal cual. */
  normalizado: boolean;
};

function aBase64(bytes: Uint8Array): string {
  let bin = "";
  const trozo = 0x8000; // por trozos: con un apply sobre el array entero se desborda la pila
  for (let i = 0; i < bytes.length; i += trozo) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + trozo)));
  }
  return btoa(bin);
}

/** Pinta la imagen centrada en un cuadrado blanco de `lado` y la saca como PNG. */
async function dibujar(bitmap: ImageBitmap, lado: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = lado;
  canvas.height = lado;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // El fondo blanco no es un capricho: un logo con transparencia se vería
  // contra el color de la tarjeta, y uno oscuro sobre una tarjeta oscura
  // desaparece. Mejor un recuadro blanco visible que un logo invisible.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, lado, lado);

  // Contener, no recortar: un logo apaisado recortado a cuadrado pierde justo
  // lo que lo identifica (ya pasó con este hotel, cuyo recorte cuadrado se
  // comió el nombre).
  const escala = Math.min(lado / bitmap.width, lado / bitmap.height);
  const ancho = bitmap.width * escala;
  const alto = bitmap.height * escala;
  ctx.drawImage(bitmap, (lado - ancho) / 2, (lado - alto) / 2, ancho, alto);

  return await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
}

/**
 * Deja el logo como un PNG cuadrado sobre blanco, tan grande como quepa.
 *
 * Si algo falla —un navegador sin createImageBitmap, un formato que no decodifica—
 * devuelve el archivo original: subir un logo pesado es mucho mejor que no
 * poder subir ninguno.
 */
export async function normalizarLogo(file: File): Promise<LogoNormalizado> {
  const original = async (): Promise<LogoNormalizado> => ({
    dataBase64: aBase64(new Uint8Array(await file.arrayBuffer())),
    contentType: file.type as LogoNormalizado["contentType"],
    normalizado: false,
  });

  try {
    if (typeof createImageBitmap !== "function") return await original();

    const bitmap = await createImageBitmap(file);

    let elegido: Blob | null = null;
    for (const lado of LADOS) {
      const blob = await dibujar(bitmap, lado);
      if (!blob) break;
      elegido = blob;
      if (blob.size <= MAXIMO_BYTES) break; // ya cabe; no hace falta empeorarlo más
    }
    bitmap.close?.();
    if (!elegido) return await original();

    // Si el original ya era PNG y pesa menos, se queda el original.
    //
    // No es una optimización: es que el canvas SIEMPRE reescribe en color
    // completo, así que un PNG indexado —pocos colores, que es como se guarda
    // un logo bien hecho— sale de aquí pesando varias veces más. Pasarlo por
    // esto "para optimizarlo" lo empeoraba 4x en uno de los comercios.
    if (file.type === "image/png" && file.size <= elegido.size) {
      return await original();
    }

    return {
      dataBase64: aBase64(new Uint8Array(await elegido.arrayBuffer())),
      contentType: "image/png",
      normalizado: true,
    };
  } catch {
    return await original();
  }
}

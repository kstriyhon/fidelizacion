// Operaciones de alto nivel para Apple Wallet (PassKit) — SOLO SERVIDOR.
//
// Conceptos:
//   - Pass Template = plantilla del pase (logo, colores, estructura)
//   - Pass Instance = pase de un cliente concreto (serial, datos personales)
//   - .pkpass = archivo ZIP firmado con PKCS#7 que iOS agrega a Wallet
//   - Web Service = webhooks donde Apple registra dispositivos y envía updates
//   - APNs = Apple Push Notification service para notificaciones push
//
// Si la config está en modo "mock", estas funciones NO generan pases reales:
// devuelven URLs simuladas para poder demostrar el flujo.

// node-forge es CJS; en ESM sus miembros (asn1, pki, pkcs7, md, ...) solo
// existen bajo el default export, no en el namespace `import *`.
import forge from "node-forge";
import JSZip from "jszip";
import {
  getAppleWalletConfig,
  type AppleWalletConfig,
  decodeBase64Certificate,
  decodeBase64PrivateKey,
} from "./apple-config.server";
import { stampDots } from "./dots";
// Se reutilizan los tipos del motor de pases: la reserva y los ajustes del
// hotel son los mismos datos para Google y para Apple, y tenerlos declarados
// dos veces garantizaría que un día dejen de coincidir.
import type { ReservationLike, HotelSettingsLike } from "./passes";
import type { EstadoFidelizacion } from "../hotelFidelizacion";

export type ProgramLike = {
  id: string;
  name: string;
  stamps_required: number;
  reward_description: string;
};

export type BusinessLike = {
  id: string;
  name: string;
  brand_color: string;
  logo_url: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type MemberLike = {
  id: string;
  full_name: string;
  stamps: number;
};

// Icono mínimo (29x29, PNG sólido color marca) requerido por el spec de Apple
// Wallet — sin icon.png, Wallet rechaza el .pkpass. Se usa como fallback cuando
// el negocio no tiene logo propio.
const DEFAULT_ICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAIAAADZ8fBYAAAAJklEQVR4nGPwd3tKC8Qwau6ouaPmjpo7au6ouaPmjpo7au6gMhcAEq3aB6dauRgAAAAASUVORK5CYII=";

// Genera un serial number único para el pase (UUID-like string)
function generateSerialNumber(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Genera un auth token para validar requests del cliente
function generateAuthToken(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Sanitiza IDs para URLs (reemplaza caracteres inválidos)
function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "_");
}

// --- Modelos JSON para el pase .pkpass -----------------------------------------

// Campo de un pase (spec de Apple): dentro de headerFields/primaryFields/
// secondaryFields/auxiliaryFields/backFields. `changeMessage` es lo que
// Wallet muestra como notificación nativa cuando el campo cambia de valor
// tras un push de actualización (%@ se sustituye por el nuevo `value`).
interface PassField {
  key: string;
  label: string;
  value: string | number;
  changeMessage?: string;
  // Con un valor ISO 8601, Wallet lo formatea en el idioma y la zona del
  // dispositivo. Mejor que mandar la fecha ya escrita: el huésped que llega de
  // otro país la ve como la escribiría en su casa.
  dateStyle?: string;
  timeStyle?: string;
}

// Apple exige EXACTAMENTE una de estas 5 claves de estilo a nivel raíz
// (boardingPass/coupon/eventTicket/generic/storeCard) con los campos
// agrupados adentro — NO existen headerFields/backFields ni "loyaltyPoints"
// sueltos a nivel raíz (eso es un concepto de Google Wallet, no de Apple).
interface StoreCardStyle {
  headerFields?: PassField[];
  primaryFields?: PassField[];
  secondaryFields?: PassField[];
  auxiliaryFields?: PassField[];
  backFields?: PassField[];
}

interface PassTemplate {
  formatVersion: number;
  passTypeIdentifier: string;
  serialNumber: string;
  teamIdentifier: string;
  organizationName: string;
  description: string;
  logoText: string;
  barcode: {
    format: string;
    message: string;
    messageEncoding: string;
  };
  // "barcodes" (plural, array) es la forma moderna desde iOS 9 — "barcode"
  // (singular) sigue soportado mostrando el primer elemento de "barcodes"
  // pero es legacy. Mandamos ambos por compatibilidad máxima.
  barcodes: Array<{
    format: string;
    message: string;
    messageEncoding: string;
  }>;
  locations?: Array<{
    latitude: number;
    longitude: number;
  }>;
  storeCard: StoreCardStyle;
  backgroundColor: string;
  foregroundColor: string;
  textColor: string;
  labelColor: string;
  // Sin estos dos, Wallet NUNCA llama a nuestro PassKit web service (no
  // registra el dispositivo, no pide actualizaciones) — el push queda muerto
  // aunque el resto del pase esté perfecto. authenticationToken debe
  // coincidir con el auth_token guardado en loyalty_apple_passes: nuestros
  // handlers en passkit.server.ts lo validan contra el header
  // "Authorization: ApplePass <token>" que Wallet manda automáticamente.
  webServiceURL: string;
  authenticationToken: string;
}

interface PassInstance extends PassTemplate {
  serialNumber: string;
}

/**
 * Pase de estancia de hotel.
 *
 * Usa el estilo "generic" y no "storeCard" porque no es una tarjeta de saldo:
 * no hay nada que acumular, hay una estancia con fechas. Es el equivalente en
 * Apple a haber elegido genericObject en Google.
 */
interface HotelPassInstance extends Omit<PassTemplate, "storeCard" | "logoText" | "description"> {
  description: string;
  logoText: string;
  generic: StoreCardStyle;
  /** Check-out. Pasada esta fecha Wallet marca el pase como caducado. */
  expirationDate?: string;
  /** Check-in. Wallet acerca el pase a la pantalla de bloqueo cerca de la fecha. */
  relevantDate?: string;
}

// --- Construcción de pases ---------------------------------------------------

/**
 * Construye la estructura JSON base del pase (plantilla).
 * Similar a buildClass en Google Wallet.
 */
export function buildPassTemplate(
  cfg: AppleWalletConfig,
  program: ProgramLike,
  business: BusinessLike,
  authToken: string,
): PassTemplate {
  // Convertir color hex a formato Apple (sin #)
  const brandColor = business.brand_color.replace("#", "");

  return {
    formatVersion: 1,
    passTypeIdentifier: cfg.passTypeId,
    serialNumber: "", // Se llena en buildPassInstance
    teamIdentifier: cfg.teamId,
    organizationName: business.name,
    description: program.name,
    logoText: business.name,
    barcode: {
      format: "PKBarcodeFormatQR",
      message: "", // Se llena en buildPassInstance (member.id)
      messageEncoding: "iso-8859-1",
    },
    barcodes: [
      {
        format: "PKBarcodeFormatQR",
        message: "", // Se llena en buildPassInstance (member.id)
        messageEncoding: "iso-8859-1",
      },
    ],
    ...(business.latitude != null && business.longitude != null
      ? {
          locations: [
            {
              latitude: business.latitude,
              longitude: business.longitude,
            },
          ],
        }
      : {}),
    storeCard: {}, // se llena en buildPassInstance (necesita stamps del member)
    // Colores: fondo del color de marca, texto blanco
    backgroundColor: `rgb(${parseInt(brandColor.substr(0, 2), 16)},${parseInt(brandColor.substr(2, 2), 16)},${parseInt(brandColor.substr(4, 2), 16)})`,
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(255, 255, 255)",
    textColor: "rgb(255, 255, 255)",
    webServiceURL: `${cfg.origin}/api/passkit`,
    authenticationToken: authToken,
  };
}

/**
 * Construye la instancia del pase para un cliente específico.
 * Similar a buildObject en Google Wallet.
 *
 * Apple NO permite texto de push arbitrario para pases — lo único que puede
 * mostrar Wallet como notificación nativa es el `changeMessage` de un campo
 * cuyo `value` cambió respecto al pase anterior instalado ("%@" se sustituye
 * por el nuevo valor). Por eso:
 *   - `stampChangeMessage`: se pone en el campo "balance" (para "diste un sello").
 *   - `auxiliaryMessage`: agrega un campo "message" cuyo VALOR es el texto que
 *     se quiere mostrar y `changeMessage: "%@"` — así el texto completo sale
 *     en la notificación (truco estándar para "mandar un mensaje" con PassKit).
 */
export function buildPassInstance(
  template: PassTemplate,
  member: MemberLike,
  program: ProgramLike,
  serialNumber: string,
  opts?: { stampChangeMessage?: string; auxiliaryMessage?: string },
): PassInstance {
  return {
    ...template,
    serialNumber,
    barcode: {
      ...template.barcode,
      message: member.id, // QR con el ID del cliente
    },
    barcodes: [
      {
        ...template.barcodes[0],
        message: member.id,
      },
    ],
    storeCard: {
      primaryFields: [
        {
          key: "balance",
          label: "Sellos",
          value: `${member.stamps}/${program.stamps_required}`,
          ...(opts?.stampChangeMessage ? { changeMessage: opts.stampChangeMessage } : {}),
        },
      ],
      secondaryFields: [
        // Fila de puntos antes del premio: es lo que el cliente mira de un
        // vistazo. Se omite si el programa tiene demasiados sellos para
        // dibujarla; el saldo "18/30" de primaryFields sigue siendo exacto.
        ...(stampDots(member.stamps, program.stamps_required)
          ? [
              {
                key: "dots",
                label: "Tus sellos",
                value: stampDots(member.stamps, program.stamps_required) as string,
              },
            ]
          : []),
        {
          key: "reward",
          label: "Premio",
          value: program.reward_description,
        },
      ],
      ...(opts?.auxiliaryMessage
        ? {
            auxiliaryFields: [
              {
                key: "message",
                label: "Aviso",
                value: opts.auxiliaryMessage,
                changeMessage: "%@",
              },
            ],
          }
        : {}),
      backFields: [
        {
          key: "reward_detail",
          label: "Premio",
          value: `${program.stamps_required} sellos = ${program.reward_description}`,
        },
        {
          key: "client_name",
          label: "Cliente",
          value: member.full_name,
        },
      ],
    },
  };
}

/**
 * Construye el pase de estancia para un huésped.
 *
 * Diferencias de fondo con el de sellos, no solo de maquetación:
 *   - caduca con el check-out (`expirationDate`), que es lo que impide que la
 *     estancia del año pasado compita con la de ahora en el Wallet del huésped;
 *   - los contactos van en backFields. Apple no tiene "botones de enlace" como
 *     Google: lo que hace es detectar teléfonos y direcciones web dentro del
 *     texto del reverso y volverlos pulsables. Por eso el teléfono se escribe
 *     tal cual y no "Llamar a recepción".
 */
export function buildHotelPassInstance(
  cfg: AppleWalletConfig,
  business: BusinessLike,
  member: MemberLike,
  /** null = el huésped ya se fue: la tarjeta pasa a modo fidelización. */
  reservation: ReservationLike | null,
  settings: HotelSettingsLike,
  serialNumber: string,
  authToken: string,
  fidelizacion?: EstadoFidelizacion,
): HotelPassInstance {
  const brand = business.brand_color.replace("#", "");
  const rgb = (i: number) => parseInt(brand.substr(i, 2), 16);
  const f = fidelizacion;

  // Reverso: lo mismo en los dos modos. Son los datos del hotel, que no dejan
  // de ser útiles porque el huésped se haya ido.
  const reverso = [
    ...(settings.reception_phone
      ? [{ key: "phone", label: "Recepción", value: settings.reception_phone }]
      : []),
    ...(settings.whatsapp ? [{ key: "wa", label: "WhatsApp", value: settings.whatsapp }] : []),
    ...(settings.website ? [{ key: "web", label: "Sitio web", value: settings.website }] : []),
    // En el reverso no hay límite práctico de campos, así que aquí cabe la
    // guía entera — al contrario que en el frente de Google, donde Wallet
    // solo pinta diez módulos.
    ...settings.guest_guide.map((g, i) => ({ key: `guia_${i}`, label: g.titulo, value: g.valor })),
    ...settings.services.map((s, i) => ({
      key: `serv_${i}`,
      label: s.titulo,
      // Se quita el esquema: Apple vuelve pulsable lo que RECONOCE como
      // correo o teléfono dentro del texto, y "mailto:ana@hotel.com" no lo
      // reconoce — se queda como texto muerto. "ana@hotel.com" sí.
      value: s.url.replace(/^(mailto:|tel:)/, ""),
    })),
  ];

  const base = {
    formatVersion: 1,
    passTypeIdentifier: cfg.passTypeId,
    serialNumber,
    teamIdentifier: cfg.teamId,
    organizationName: business.name,
    logoText: business.name,
    backgroundColor: `rgb(${rgb(0)},${rgb(2)},${rgb(4)})`,
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(255, 255, 255)",
    textColor: "rgb(255, 255, 255)",
    webServiceURL: `${cfg.origin}/api/passkit`,
    authenticationToken: authToken,
    barcode: {
      format: "PKBarcodeFormatQR",
      message: member.id,
      messageEncoding: "iso-8859-1",
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: member.id, messageEncoding: "iso-8859-1" }],
    ...(business.latitude != null && business.longitude != null
      ? { locations: [{ latitude: business.latitude, longitude: business.longitude }] }
      : {}),
  };

  // --- Modo FIDELIZACIÓN: ya no hay estancia ---------------------------------
  // Sin expirationDate, así que la tarjeta deja de estar vencida. Como se
  // refirma el MISMO serial, el iPhone la reconoce como la de siempre y la
  // actualiza en su sitio en vez de añadir otra.
  if (!reservation) {
    return {
      ...base,
      description: `Tarjeta de ${business.name}`,
      generic: {
        headerFields: f?.nivel ? [{ key: "nivel", label: "Nivel", value: f.nivel.nombre }] : [],
        primaryFields: [{ key: "guest", label: "Huésped", value: member.full_name }],
        secondaryFields: [
          ...(f ? [{ key: "estancias", label: "Estancias", value: String(f.estancias) }] : []),
          ...(f && f.noches > 0
            ? [{ key: "noches", label: "Noches", value: String(f.noches) }]
            : []),
        ],
        auxiliaryFields: [
          ...(f?.nivel
            ? [{ key: "beneficio", label: "Tu beneficio", value: f.nivel.beneficio }]
            : []),
          ...(f?.siguiente
            ? [
                {
                  key: "siguiente",
                  label: `Para ${f.siguiente.nombre}`,
                  value: f.faltan === 1 ? "1 estancia más" : `${f.faltan} estancias más`,
                },
              ]
            : []),
        ],
        backFields: reverso,
      },
    };
  }

  return {
    ...base,
    description: `Estancia en ${business.name}`,

    expirationDate: new Date(reservation.check_out).toISOString(),
    relevantDate: new Date(reservation.check_in).toISOString(),

    generic: {
      headerFields: reservation.room
        ? [{ key: "room", label: "Habitación", value: reservation.room }]
        : [],
      primaryFields: [{ key: "guest", label: "Huésped", value: member.full_name }],
      secondaryFields: [
        {
          key: "checkin",
          label: "Llegada",
          value: new Date(reservation.check_in).toISOString(),
          dateStyle: "PKDateStyleMedium",
          timeStyle: "PKDateStyleShort",
        },
        {
          key: "checkout",
          label: "Salida",
          value: new Date(reservation.check_out).toISOString(),
          dateStyle: "PKDateStyleMedium",
          timeStyle: "PKDateStyleShort",
        },
      ],
      auxiliaryFields: [
        { key: "code", label: "Reserva", value: reservation.reservation_code },
        { key: "guests", label: "Huéspedes", value: String(reservation.guests) },
        // El nivel acompaña a la estancia: es estando en el hotel cuando al
        // huésped le sirve saber qué le da su nivel.
        ...(f?.nivel ? [{ key: "nivel", label: "Nivel", value: f.nivel.nombre }] : []),
      ],
      backFields: reverso,
    },
  };
}

// --- Firma PKCS#7 -----------------------------------------------------------

/**
 * Firma un .pkpass (ZIP) con PKCS#7 usando node-forge.
 * Retorna el archivo signatureFile que va dentro del ZIP.
 */
async function signPass(
  passJsonString: string,
  certP12Buffer: Buffer,
  certPassword: string,
  wwdrCertBuffer: Buffer,
): Promise<Buffer> {
  try {
    // 1. Parsear P12 (contiene la clave privada + certificado)
    const p12Asn1 = forge.asn1.fromDer(certP12Buffer.toString("binary"));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, certPassword);

    // Extraer la bolsa con la clave privada y certificado
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });

    if (!keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] || !certBags[forge.pki.oids.certBag]) {
      throw new Error("No private key or certificate found in P12");
    }

    const privateKey = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]![0].key;
    const cert = certBags[forge.pki.oids.certBag]![0].cert;

    if (!privateKey || !cert) {
      throw new Error("Failed to extract private key or certificate from P12");
    }

    // 2. Parsear WWDR (certificado intermedio)
    const wwdrCertDer = forge.asn1.fromDer(wwdrCertBuffer.toString("binary"));
    const wwdrCert = forge.pki.certificateFromAsn1(wwdrCertDer);

    // 3. Crear PKCS#7 SignedData (detached = solo firma, sin contenido)
    // OJO: createBuffer sin encoding "utf8" trata el string como bytes 1:1
    // (raw/latin1) — con nombres de negocio que tengan tildes/ñ, eso produce
    // bytes distintos a los que realmente va a tener pass.json en el ZIP
    // (JSZip sí codifica el string como UTF-8), y la firma queda inválida.
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(passJsonString, "utf8");

    // Agregar certificados
    p7.addCertificate(cert);
    p7.addCertificate(wwdrCert);

    // IMPORTANTE: sign() no genera ningún signerInfo si no se llama antes a
    // addSigner() — sin esto, sign() retorna en silencio (sin lanzar error)
    // dejando el SET de signerInfos vacío, produciendo un .pkpass con una
    // "firma" sin firmante real que Wallet rechaza.
    //
    // Apple SÍ requiere authenticatedAttributes en la práctica (quitarlos
    // produce "RSA signature verification failed, no match" — un fallo más
    // genérico, probado en un iPhone real). El bug real era el ORDEN: DER
    // exige que un SET OF esté en orden canónico — comparando los bytes
    // codificados completos de cada elemento, NO el valor del OID. node-forge
    // NO ordena esto solo; codifica los atributos en el orden que se le pasan.
    // El orden "obvio" (contentType, messageDigest, signingTime) NO es el
    // canónico: al codificar cada atributo como DER y comparar sus bytes,
    // sale messageDigest(17 bytes) < contentType(26 bytes) < signingTime(30
    // bytes) — confirmado programáticamente. openssl es permisivo con SET OF
    // fuera de orden; el validador estricto de Apple no, y rechazaba el pase
    // con "Message-digest attribute failed to verify" pese a que el digest
    // embebido coincidía byte a byte con el pass.json real.
    p7.addSigner({
      key: privateKey,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
      ],
    });

    p7.sign({ detached: true });

    // 4. Convertir a DER
    const signature = forge.asn1.toDer(p7.toAsn1());
    return Buffer.from(signature.getBytes(), "binary");
  } catch (error) {
    throw new Error(
      `Failed to sign pass: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// --- Generación de .pkpass (ZIP) -------------------------------------------

/**
 * Genera un archivo .pkpass (ZIP con estructura específica y firma).
 * Retorna un Buffer que puede servirse como descarga.
 */
export async function generatePKPass(
  passJson: PassInstance | HotelPassInstance,
  logoBase64: string | null,
  cfg: Extract<AppleWalletConfig, { mode: "live" }>,
): Promise<Buffer> {
  // Estructura de un .pkpass según el spec de Apple:
  //   1. Los archivos del bundle: pass.json, icon.png, [logo.png], ...
  //   2. manifest.json = { "<archivo>": "<sha1 hex>" } de TODOS esos archivos.
  //      NO se incluye a sí mismo ni a "signature".
  //   3. signature = firma PKCS#7 DETACHED de **manifest.json** (NO de
  //      pass.json). Wallet verifica la firma contra manifest.json, y luego
  //      que cada hash del manifest coincida con el archivo real.
  //
  // Firmar pass.json en vez de manifest.json (y meter "signature" dentro del
  // manifest) es lo que producía en un iPhone real:
  //   "Manifest signature did not verify successfully".
  // Verificar la firma con openssl contra pass.json daba "Verification
  // successful" — pero era circular: confirmaba que firmamos lo que firmamos,
  // no que fuera el archivo correcto según el spec.
  const files: Record<string, Buffer> = {
    "pass.json": Buffer.from(JSON.stringify(passJson), "utf8"),
    // icon.png es obligatorio o Wallet rechaza el pase. Si el negocio no tiene
    // logo propio, se usa un ícono sólido del color de marca como fallback.
    "icon.png": Buffer.from(logoBase64 ?? DEFAULT_ICON_PNG_BASE64, "base64"),
  };

  // Si hay logo del negocio, además va como logo.png (aparece arriba en el
  // pase, es distinto del icon.png).
  if (logoBase64) {
    files["logo.png"] = Buffer.from(logoBase64, "base64");
  }

  const manifest: Record<string, string> = {};
  for (const [name, buf] of Object.entries(files)) {
    const md = forge.md.sha1.create();
    md.update(buf.toString("binary"));
    manifest[name] = md.digest().toHex();
  }
  const manifestString = JSON.stringify(manifest);

  const certP12Buffer = decodeBase64Certificate(cfg.certificateP12Base64);
  const wwdrCertBuffer = decodeBase64Certificate(cfg.wwdrCertificateBase64);
  const signature = await signPass(
    manifestString,
    certP12Buffer,
    cfg.certificatePassword,
    wwdrCertBuffer,
  );

  const zip = new JSZip();
  for (const [name, buf] of Object.entries(files)) {
    zip.file(name, buf);
  }
  zip.file("manifest.json", manifestString);
  zip.file("signature", signature);

  const pkpassBuffer = await zip.generateAsync({ type: "nodebuffer" });

  return pkpassBuffer;
}

// --- API pública del módulo -------------------------------------------------

/**
 * Descarga el logo del negocio para meterlo dentro del .pkpass.
 *
 * Hasta ahora nadie pasaba `logoBase64`, así que TODOS los pases de Apple
 * salían con el cuadrado de color de reserva mientras los de Google sí lucían
 * el logo. Esto lo resuelve en el sitio común, no solo para hoteles.
 *
 * Es best-effort a propósito: un logo que no carga no puede impedir que un
 * cliente se lleve su tarjeta.
 */
async function fetchLogoBase64(business: BusinessLike): Promise<string | null> {
  if (!business.logo_url) return null;
  try {
    const res = await fetch(business.logo_url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    // Apple SOLO admite PNG dentro del bundle. Un JPEG colado como icon.png no
    // da error al firmar: el pase se instala y la imagen sale rota, que es peor
    // que no poner ninguna.
    const tipo = res.headers.get("content-type") ?? "";
    if (!tipo.includes("png")) {
      console.warn(
        `[apple] logo de ${business.name} no es PNG (${tipo}); se usa el color de marca.`,
      );
      return null;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    // El .pkpass se guarda entero en la base y se refirma en cada cambio, así
    // que un logo enorme se paga muchas veces. Medio mega ya es desproporcionado
    // para una imagen que Wallet pinta a 29 puntos.
    if (buf.length > 512 * 1024) {
      console.warn(
        `[apple] logo de ${business.name} demasiado grande (${buf.length} bytes); se omite.`,
      );
      return null;
    }
    return buf.toString("base64");
  } catch (err) {
    console.warn("[apple] no se pudo descargar el logo:", err);
    return null;
  }
}

/**
 * true si hay que emitir un pase de estancia.
 *
 * Exige el tipo Y los datos de la reserva: un programa marcado como hotel pero
 * sin reserva es un error de quien llama, y es preferible emitir el pase de
 * siempre que reventar en la cara del huésped mientras se registra.
 */
function esHotel(extra?: {
  tipo?: string;
  hotel?: {
    reservation: ReservationLike | null;
    settings: HotelSettingsLike;
    fidelizacion?: EstadoFidelizacion;
  };
}): extra is {
  tipo: string;
  hotel: {
    reservation: ReservationLike | null;
    settings: HotelSettingsLike;
    fidelizacion?: EstadoFidelizacion;
  };
} {
  return extra?.tipo === "hotel" && Boolean(extra.hotel);
}

/**
 * Crea un pase de Apple Wallet para un cliente.
 * Retorna serialNumber, descargaUrl (si live), y metadata.
 */
export async function createMemberApplePass(
  member: MemberLike,
  program: ProgramLike,
  business: BusinessLike,
  logoBase64: string | null = null,
  /** Tipo de programa y, si es hotel, su reserva y sus ajustes. */
  extra?: {
    tipo?: string;
    hotel?: {
      reservation: ReservationLike | null;
      settings: HotelSettingsLike;
      fidelizacion?: EstadoFidelizacion;
    };
  },
): Promise<{
  serialNumber: string;
  authToken: string;
  downloadUrl: string | null;
  pkpassBuffer: Buffer | null;
  mock: boolean;
}> {
  const cfg = getAppleWalletConfig();

  const serialNumber = generateSerialNumber();
  const authToken = generateAuthToken();

  // Modo mock: simular sin generar pases reales
  if (cfg.mode === "mock") {
    const mockUrl = `${cfg.origin}/api/passkit/download/${serialNumber}?t=${authToken}`;
    return {
      serialNumber,
      authToken,
      downloadUrl: mockUrl,
      pkpassBuffer: null,
      mock: true,
    };
  }

  // Modo live: generar pase real
  try {
    const logo = logoBase64 ?? (await fetchLogoBase64(business));
    // 1. Construir el pase que toque según la vertical
    const passInstance = esHotel(extra)
      ? buildHotelPassInstance(
          cfg,
          business,
          member,
          extra.hotel.reservation,
          extra.hotel.settings,
          serialNumber,
          authToken,
          extra.hotel.fidelizacion,
        )
      : buildPassInstance(
          buildPassTemplate(cfg, program, business, authToken),
          member,
          program,
          serialNumber,
        );

    // 2. Generar .pkpass (ZIP). generatePKPass arma el manifest y firma
    // manifest.json internamente. El llamador lo persiste (DB/storage) para
    // poder servirlo en /api/passkit/download/:serial.
    const pkpassBuffer = await generatePKPass(passInstance, logo, cfg);

    // 3. URL de descarga pública (sin auth header especial de Apple — la
    // usan el navegador/Wallet la primera vez). El token en query es una
    // protección mínima contra adivinar el serial.
    const downloadUrl = `${cfg.origin}/api/passkit/download/${serialNumber}?t=${authToken}`;

    return {
      serialNumber,
      authToken,
      downloadUrl,
      pkpassBuffer,
      mock: false,
    };
  } catch (error) {
    throw new Error(
      `Failed to create Apple pass: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Reconstruye y refirma el .pkpass de un cliente que YA tiene un pase
 * (mismo serialNumber y passTypeIdentifier — Wallet lo reconoce como el
 * mismo pase instalado, no uno nuevo). Se usa cuando cambian los sellos o se
 * quiere mandar un mensaje puntual. El caller (loyaltyActions.ts) es quien
 * persiste el buffer resultante en `loyalty_apple_passes.signature` y quien
 * dispara el push por APNs a los dispositivos registrados de ese cliente.
 *
 * `opts.stampChangeMessage`: texto para la notificación al cambiar sellos.
 * `opts.auxiliaryMessage`: mensaje puntual (mismo mecanismo, campo distinto).
 */
export async function regenerateApplePassBuffer(
  member: MemberLike,
  program: ProgramLike,
  business: BusinessLike,
  serialNumber: string,
  authToken: string,
  opts?: { stampChangeMessage?: string; auxiliaryMessage?: string },
  logoBase64: string | null = null,
  extra?: {
    tipo?: string;
    hotel?: {
      reservation: ReservationLike | null;
      settings: HotelSettingsLike;
      fidelizacion?: EstadoFidelizacion;
    };
  },
): Promise<{ pkpassBuffer: Buffer | null; mock: boolean }> {
  const cfg = getAppleWalletConfig();

  if (cfg.mode === "mock") {
    return { pkpassBuffer: null, mock: true };
  }

  try {
    const logo = logoBase64 ?? (await fetchLogoBase64(business));
    const passInstance = esHotel(extra)
      ? buildHotelPassInstance(
          cfg,
          business,
          member,
          extra.hotel.reservation,
          extra.hotel.settings,
          serialNumber,
          authToken,
          extra.hotel.fidelizacion,
        )
      : buildPassInstance(
          buildPassTemplate(cfg, program, business, authToken),
          member,
          program,
          serialNumber,
          opts,
        );

    const pkpassBuffer = await generatePKPass(passInstance, logo, cfg);

    return { pkpassBuffer, mock: false };
  } catch (error) {
    throw new Error(
      `Failed to regenerate Apple pass: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

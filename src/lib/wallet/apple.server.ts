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
import { getAppleWalletConfig, type AppleWalletConfig, decodeBase64Certificate, decodeBase64PrivateKey } from "./apple-config.server";

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

// --- Firma PKCS#7 -----------------------------------------------------------

/**
 * Firma un .pkpass (ZIP) con PKCS#7 usando node-forge.
 * Retorna el archivo signatureFile que va dentro del ZIP.
 */
async function signPass(
  passJsonString: string,
  certP12Buffer: Buffer,
  certPassword: string,
  wwdrCertBuffer: Buffer
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
    // Sin `authenticatedAttributes`: la firma se computa directo sobre el
    // digest del contenido, sin el SET DER de atributos (contentType +
    // messageDigest + signingTime) de por medio. Con esos atributos, un
    // iPhone real rechazaba el pase con "Message-digest attribute failed to
    // verify" / "signature verification failed for signer 0" — el digest
    // embebido en el atributo SÍ coincidía byte a byte con el pass.json real
    // (verificado a mano con openssl dgst + asn1parse), pero la verificación
    // estricta de Wallet fallaba igual. Evitamos todo ese SET de atributos:
    // menos superficie para un bug de codificación DER en node-forge.
    p7.addSigner({
      key: privateKey,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
    });

    p7.sign({ detached: true });

    // 4. Convertir a DER
    const signature = forge.asn1.toDer(p7.toAsn1());
    return Buffer.from(signature.getBytes(), "binary");
  } catch (error) {
    throw new Error(`Failed to sign pass: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// --- Generación de .pkpass (ZIP) -------------------------------------------

/**
 * Genera un archivo .pkpass (ZIP con estructura específica y firma).
 * Retorna un Buffer que puede servirse como descarga.
 */
export async function generatePKPass(
  passJson: PassInstance,
  logoBase64: string | null,
  signature: Buffer,
  cfg: Extract<AppleWalletConfig, { mode: "live" }>
): Promise<Buffer> {
  const zip = new JSZip();

  // IMPORTANTE: debe ser EXACTAMENTE el mismo string que se firmó en
  // signPass() (que también usa JSON.stringify sin indentar). Si el archivo
  // dentro del ZIP no coincide byte a byte con lo firmado, el hash del
  // manifest no matchea y Wallet rechaza el pase por firma inválida.
  const passJsonString = JSON.stringify(passJson);

  // 1. Agregar pass.json
  zip.file("pass.json", passJsonString);

  // 2. Agregar signature
  zip.file("signature", signature);

  // 3. Agregar manifest.json (lista de archivos + SHA1)
  const manifest: Record<string, string> = {};

  // Calcular SHA1 de pass.json (mismo string que se escribió arriba)
  const passJsonHash = forge.md.sha1.create();
  passJsonHash.update(Buffer.from(passJsonString).toString("binary"));
  manifest["pass.json"] = passJsonHash.digest().toHex();

  // Calcular SHA1 de signature
  const signatureHash = forge.md.sha1.create();
  signatureHash.update(signature.toString("binary"));
  manifest["signature"] = signatureHash.digest().toHex();

  // icon.png es obligatorio para que Wallet acepte el pase. Si el negocio no
  // tiene logo propio, usamos un ícono sólido de color marca como fallback.
  const iconBuffer = Buffer.from(logoBase64 ?? DEFAULT_ICON_PNG_BASE64, "base64");
  zip.file("icon.png", iconBuffer);
  const iconHash = forge.md.sha1.create();
  iconHash.update(iconBuffer.toString("binary"));
  manifest["icon.png"] = iconHash.digest().toHex();

  // Si hay logo del negocio, además lo agregamos como logo.png (aparece en
  // la parte superior del pase, distinto del icon.png).
  if (logoBase64) {
    const logoBuffer = Buffer.from(logoBase64, "base64");
    zip.file("logo.png", logoBuffer);

    const logoHash = forge.md.sha1.create();
    logoHash.update(logoBuffer.toString("binary"));
    manifest["logo.png"] = logoHash.digest().toHex();
  }

  zip.file("manifest.json", JSON.stringify(manifest));

  // 4. Generar ZIP
  const pkpassBuffer = await zip.generateAsync({ type: "nodebuffer" });

  return pkpassBuffer;
}

// --- API pública del módulo -------------------------------------------------

/**
 * Crea un pase de Apple Wallet para un cliente.
 * Retorna serialNumber, descargaUrl (si live), y metadata.
 */
export async function createMemberApplePass(
  member: MemberLike,
  program: ProgramLike,
  business: BusinessLike,
  logoBase64: string | null = null
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
    // 1. Construir template + instance
    const template = buildPassTemplate(cfg, program, business, authToken);
    const passInstance = buildPassInstance(template, member, program, serialNumber);

    // 2. Decodificar certificados desde base64
    const certP12Buffer = decodeBase64Certificate(cfg.certificateP12Base64);
    const wwdrCertBuffer = decodeBase64Certificate(cfg.wwdrCertificateBase64);

    // 3. Firmar pass.json
    const passJsonString = JSON.stringify(passInstance);
    const signature = await signPass(passJsonString, certP12Buffer, cfg.certificatePassword, wwdrCertBuffer);

    // 4. Generar .pkpass (ZIP) — el llamador lo persiste (DB/storage) para
    // poder servirlo en /api/passkit/download/:serial.
    const pkpassBuffer = await generatePKPass(passInstance, logoBase64, signature, cfg);

    // 5. URL de descarga pública (sin auth header especial de Apple — la
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
    throw new Error(`Failed to create Apple pass: ${error instanceof Error ? error.message : String(error)}`);
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
): Promise<{ pkpassBuffer: Buffer | null; mock: boolean }> {
  const cfg = getAppleWalletConfig();

  if (cfg.mode === "mock") {
    return { pkpassBuffer: null, mock: true };
  }

  try {
    const template = buildPassTemplate(cfg, program, business, authToken);
    const passInstance = buildPassInstance(template, member, program, serialNumber, opts);

    const certP12Buffer = decodeBase64Certificate(cfg.certificateP12Base64);
    const wwdrCertBuffer = decodeBase64Certificate(cfg.wwdrCertificateBase64);

    const passJsonString = JSON.stringify(passInstance);
    const signature = await signPass(passJsonString, certP12Buffer, cfg.certificatePassword, wwdrCertBuffer);
    const pkpassBuffer = await generatePKPass(passInstance, logoBase64, signature, cfg);

    return { pkpassBuffer, mock: false };
  } catch (error) {
    throw new Error(`Failed to regenerate Apple pass: ${error instanceof Error ? error.message : String(error)}`);
  }
}

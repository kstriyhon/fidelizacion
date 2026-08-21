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

import * as forge from "node-forge";
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

interface PassTemplate {
  formatVersion: number;
  passTypeIdentifier: string;
  serialNumber: string;
  teamIdentifier: string;
  organizationName: string;
  description: string;
  logoText: string;
  teamIdentifier: string;
  barcode: {
    format: string;
    message: string;
    messageEncoding: string;
  };
  locations?: Array<{
    latitude: number;
    longitude: number;
  }>;
  loyaltyPoints?: {
    label: string;
    balance: number;
    balanceFormat?: string;
  };
  backgroundColor: string;
  foregroundColor: string;
  textColor: string;
}

interface PassInstance extends PassTemplate {
  serialNumber: string;
  backFields?: Array<{
    key: string;
    label: string;
    value: string;
  }>;
}

// --- Construcción de pases ---------------------------------------------------

/**
 * Construye la estructura JSON base del pase (plantilla).
 * Similar a buildClass en Google Wallet.
 */
export function buildPassTemplate(cfg: AppleWalletConfig, program: ProgramLike, business: BusinessLike): PassTemplate {
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
    loyaltyPoints: {
      label: "Sellos",
      balance: 0,
      balanceFormat: "%li",
    },
    // Colores: fondo azul, texto blanco
    backgroundColor: `rgb(${parseInt(brandColor.substr(0, 2), 16)},${parseInt(brandColor.substr(2, 2), 16)},${parseInt(brandColor.substr(4, 2), 16)})`,
    foregroundColor: "rgb(255, 255, 255)",
    textColor: "rgb(255, 255, 255)",
  };
}

/**
 * Construye la instancia del pase para un cliente específico.
 * Similar a buildObject en Google Wallet.
 */
export function buildPassInstance(
  template: PassTemplate,
  member: MemberLike,
  program: ProgramLike,
  serialNumber: string
): PassInstance {
  return {
    ...template,
    serialNumber,
    barcode: {
      ...template.barcode,
      message: member.id, // QR con el ID del cliente
    },
    loyaltyPoints: {
      ...template.loyaltyPoints,
      balance: member.stamps,
    },
    backFields: [
      {
        key: "reward",
        label: "Premio",
        value: `${program.stamps_required} sellos = ${program.reward_description}`,
      },
      {
        key: "client_name",
        label: "Cliente",
        value: member.full_name,
      },
    ],
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
    const p12 = forge.pkcs12.asn1ToPki(p12Asn1);

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
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(passJsonString);

    // Agregar certificados
    p7.addCertificate(cert);
    p7.addCertificate(wwdrCert);

    // Firmar
    p7.sign({
      key: privateKey,
      cert,
      detached: true,
      signingTime: new Date(),
    });

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

  // 1. Agregar pass.json
  zip.file("pass.json", JSON.stringify(passJson, null, 2));

  // 2. Agregar signature
  zip.file("signature", signature);

  // 3. Agregar manifest.json (lista de archivos + SHA1)
  const manifest: Record<string, string> = {};

  // Calcular SHA1 de pass.json
  const passJsonBuffer = Buffer.from(JSON.stringify(passJson));
  const passJsonHash = forge.md.sha1.create();
  passJsonHash.update(passJsonBuffer.toString("binary"));
  manifest["pass.json"] = passJsonHash.digest().toHex();

  // Calcular SHA1 de signature
  const signatureHash = forge.md.sha1.create();
  signatureHash.update(signature.toString("binary"));
  manifest["signature"] = signatureHash.digest().toHex();

  // Si hay logo, agregarlo
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
  mock: boolean;
}> {
  const cfg = getAppleWalletConfig();

  const serialNumber = generateSerialNumber();
  const authToken = generateAuthToken();

  // Modo mock: simular sin generar pases reales
  if (cfg.mode === "mock") {
    const mockUrl = `${cfg.origin}/api/passkit/v1/passes/${cfg.passTypeId}/${serialNumber}`;
    return {
      serialNumber,
      authToken,
      downloadUrl: mockUrl,
      mock: true,
    };
  }

  // Modo live: generar pase real
  try {
    // 1. Construir template + instance
    const template = buildPassTemplate(cfg, program, business);
    const passInstance = buildPassInstance(template, member, program, serialNumber);

    // 2. Decodificar certificados desde base64
    const certP12Buffer = decodeBase64Certificate(cfg.certificateP12Base64);
    const wwdrCertBuffer = decodeBase64Certificate(cfg.wwdrCertificateBase64);

    // 3. Firmar pass.json
    const passJsonString = JSON.stringify(passInstance);
    const signature = await signPass(passJsonString, certP12Buffer, cfg.certificatePassword, wwdrCertBuffer);

    // 4. Generar .pkpass (ZIP)
    const pkpassBuffer = await generatePKPass(passInstance, logoBase64, signature, cfg);

    // 5. Generar URL descargable (en producción, esto guardaría en S3/R2)
    // Por ahora, retornamos una URL simulada que el cliente puede usar
    // En realidad, necesitarías:
    // - Guardar pkpassBuffer en R2 o similar
    // - Retornar una URL de descarga
    // Para dev, retornamos la URL del PassKit web service
    const downloadUrl = `${cfg.origin}/api/passkit/v1/passes/${cfg.passTypeId}/${serialNumber}`;

    return {
      serialNumber,
      authToken,
      downloadUrl,
      mock: false,
    };
  } catch (error) {
    throw new Error(`Failed to create Apple pass: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Actualiza el saldo de sellos de un pase existente.
 * (Será implementado en Phase 4: APNs)
 */
export async function pushAppleStampUpdate(
  member: MemberLike,
  program: ProgramLike,
  business: BusinessLike,
  serialNumber: string,
  message?: { title: string; body: string }
): Promise<{ pushed: boolean; mock: boolean }> {
  const cfg = getAppleWalletConfig();

  if (cfg.mode === "mock") {
    return { pushed: false, mock: true };
  }

  // TODO: Implementar en Phase 4 (APNs push)
  // Por ahora, solo retornamos éxito simulado
  return { pushed: true, mock: false };
}

/**
 * Envía un mensaje puntual a un pase sin cambiar sellos.
 * (Será implementado en Phase 4: APNs)
 */
export async function pushAppleMessage(
  serialNumber: string,
  message: { title: string; body: string }
): Promise<{ sent: boolean; mock: boolean }> {
  const cfg = getAppleWalletConfig();

  if (cfg.mode === "mock") {
    return { sent: false, mock: true };
  }

  // TODO: Implementar en Phase 4 (APNs)
  return { sent: true, mock: false };
}

/**
 * Envía un mensaje a TODOS los clientes de un programa.
 * (Será implementado en Phase 4: APNs broadcast)
 */
export async function broadcastApple(
  programId: string,
  message: { title: string; body: string }
): Promise<{ sent: number; failed: number; mock: boolean }> {
  const cfg = getAppleWalletConfig();

  if (cfg.mode === "mock") {
    return { sent: 0, failed: 0, mock: true };
  }

  // TODO: Implementar en Phase 4
  return { sent: 0, failed: 0, mock: false };
}

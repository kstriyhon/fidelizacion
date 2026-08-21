#!/usr/bin/env python3
"""
Script para generar PDF con guía de obtención de certificados Apple para Wallet y APNs
"""

from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.lib import colors
from datetime import datetime

# Configuración del documento
pdf_path = r"C:\Users\Owner\Desktop\tarjeta-fidelizacion\APPLE_CERTIFICATES_GUIDE.pdf"
doc = SimpleDocTemplate(pdf_path, pagesize=letter, topMargin=0.75*inch, bottomMargin=0.75*inch)

# Estilos
styles = getSampleStyleSheet()
title_style = ParagraphStyle(
    'CustomTitle',
    parent=styles['Heading1'],
    fontSize=24,
    textColor=colors.HexColor('#1F2937'),
    spaceAfter=12,
    alignment=TA_CENTER,
    fontName='Helvetica-Bold'
)

heading_style = ParagraphStyle(
    'CustomHeading',
    parent=styles['Heading2'],
    fontSize=14,
    textColor=colors.HexColor('#374151'),
    spaceAfter=8,
    spaceBefore=12,
    fontName='Helvetica-Bold'
)

subheading_style = ParagraphStyle(
    'SubHeading',
    parent=styles['Heading3'],
    fontSize=11,
    textColor=colors.HexColor('#4B5563'),
    spaceAfter=6,
    spaceBefore=8,
    fontName='Helvetica-Bold'
)

body_style = ParagraphStyle(
    'CustomBody',
    parent=styles['Normal'],
    fontSize=10,
    textColor=colors.HexColor('#1F2937'),
    spaceAfter=6,
    alignment=TA_JUSTIFY,
    leading=14
)

warning_style = ParagraphStyle(
    'Warning',
    parent=styles['Normal'],
    fontSize=9,
    textColor=colors.HexColor('#92400E'),
    spaceAfter=6,
    leftIndent=20,
    rightIndent=20,
    fontName='Helvetica-Oblique'
)

code_style = ParagraphStyle(
    'Code',
    parent=styles['Normal'],
    fontSize=8,
    textColor=colors.HexColor('#1E40AF'),
    spaceAfter=6,
    leftIndent=20,
    fontName='Courier',
    backColor=colors.HexColor('#F3F4F6')
)

# Contenido
story = []

# Portada
story.append(Spacer(1, 0.5*inch))
story.append(Paragraph("Guía de Certificados", title_style))
story.append(Paragraph("Apple Wallet & APNs", title_style))
story.append(Spacer(1, 12))
story.append(Paragraph("Para Proyecto Fideliza", styles['Heading3']))
story.append(Spacer(1, 8))
story.append(Paragraph(f"Generado: {datetime.now().strftime('%d de %B de %Y')}", styles['Normal']))
story.append(PageBreak())

# Índice
story.append(Paragraph("Contenido", heading_style))
story.append(Paragraph("1. Requisitos Previos", body_style))
story.append(Paragraph("2. Obtener Wallet Signing Certificate (.p12)", body_style))
story.append(Paragraph("3. Obtener WWDR Certificate", body_style))
story.append(Paragraph("4. Obtener APNs Private Key (.p8)", body_style))
story.append(Paragraph("5. Exportar desde Keychain (si ya existe)", body_style))
story.append(Paragraph("6. Notas de Seguridad", body_style))
story.append(Paragraph("7. Estructura de Archivos Local", body_style))
story.append(Paragraph("8. Validación de Certificados", body_style))
story.append(PageBreak())

# Sección 1: Requisitos Previos
story.append(Paragraph("1. Requisitos Previos", heading_style))
story.append(Paragraph(
    "Antes de comenzar, necesitas:",
    body_style
))
story.append(Paragraph("• Cuenta Apple Developer con membresía activa ($99/año)", body_style))
story.append(Paragraph("• Acceso a <b>developer.apple.com/account</b>", body_style))
story.append(Paragraph("• Team ID y Pass Type ID (obtenido en Wallet Console)", body_style))
story.append(Paragraph("• Mac con Keychain Access (o software de gestión de certs)", body_style))
story.append(Paragraph("• OpenSSL instalado en terminal (macOS lo trae)", body_style))
story.append(Spacer(1, 8))
story.append(Paragraph(
    "<b>Nota:</b> Ten en cuenta tu <b>Team ID</b> (10 caracteres alfanuméricos). Lo necesitarás en cada paso.",
    warning_style
))
story.append(PageBreak())

# Sección 2: Wallet Signing Certificate
story.append(Paragraph("2. Obtener Wallet Signing Certificate (.p12)", heading_style))
story.append(Paragraph(
    "Este es el certificado que usaremos para firmar los pases .pkpass.",
    body_style
))
story.append(Spacer(1, 8))

story.append(Paragraph("Paso 1: Generar una Certificate Signing Request (CSR)", subheading_style))
story.append(Paragraph("En tu Mac, abre Terminal y ejecuta:", body_style))
story.append(Paragraph(
    'openssl req -new -newkey rsa:2048 -nodes -keyout pass-signing.key -out pass-signing.csr -subj "/CN=Pass Signing Certificate"',
    code_style
))
story.append(Paragraph(
    "Esto genera dos archivos: <b>pass-signing.key</b> (clave privada) y <b>pass-signing.csr</b> (solicitud).",
    body_style
))
story.append(Spacer(1, 8))

story.append(Paragraph("Paso 2: Crear un Pass Type ID (si no lo tienes)", subheading_style))
story.append(Paragraph(
    "Ve a: <b>https://developer.apple.com/account/resources/identifiers/list</b>",
    body_style
))
story.append(Paragraph("1. Click <b>+</b> (arriba a la derecha)", body_style))
story.append(Paragraph("2. Selecciona <b>Pass Type IDs</b>", body_style))
story.append(Paragraph("3. Click <b>Continue</b>", body_style))
story.append(Paragraph("4. Ingresa Descripción: <b>Fideliza Loyalty Pass</b>", body_style))
story.append(Paragraph("5. Ingresa ID: <b>pass.{TU_TEAM_ID}.fideliza</b>", body_style))
story.append(Paragraph("6. Click <b>Register</b> → <b>Done</b>", body_style))
story.append(Spacer(1, 8))

story.append(Paragraph("Paso 3: Crear Wallet Signing Certificate", subheading_style))
story.append(Paragraph(
    "Ve a: <b>https://developer.apple.com/account/resources/certificates/list</b>",
    body_style
))
story.append(Paragraph("1. Click <b>+</b> (arriba a la derecha)", body_style))
story.append(Paragraph("2. Selecciona <b>Pass Type ID Certificate</b>", body_style))
story.append(Paragraph("3. Click <b>Continue</b>", body_style))
story.append(Paragraph("4. Selecciona tu Pass Type ID que acabas de crear", body_style))
story.append(Paragraph("5. Click <b>Continue</b>", body_style))
story.append(Paragraph("6. Sube el archivo <b>pass-signing.csr</b> que generaste en Paso 1", body_style))
story.append(Paragraph("7. Click <b>Continue</b> → <b>Download</b>", body_style))
story.append(Paragraph(
    "El archivo se descargará como <b>pass.cer</b>. Guárdalo.",
    body_style
))
story.append(Spacer(1, 8))

story.append(Paragraph("Paso 4: Convertir .cer a .p12", subheading_style))
story.append(Paragraph(
    "Tienes dos opciones:",
    body_style
))
story.append(Paragraph("<b>Opción A: Usando openssl (recomendado)</b>", body_style))
story.append(Paragraph(
    "openssl pkcs12 -export -in pass.cer -inkey pass-signing.key -out pass-signing.p12 -name 'Wallet Signing'",
    code_style
))
story.append(Paragraph(
    "Te pedirá una contraseña: <b>ingresa algo seguro</b> (la necesitarás luego).",
    warning_style
))
story.append(Spacer(1, 4))
story.append(Paragraph("<b>Opción B: Usando Keychain Access (macOS)</b>", body_style))
story.append(Paragraph("1. Doble-click en <b>pass.cer</b> para importarlo a Keychain", body_style))
story.append(Paragraph("2. Abre <b>Keychain Access</b> (Aplicaciones → Utilidades)", body_style))
story.append(Paragraph("3. Busca <b>Wallet Signing</b> (o el CN que usaste)", body_style))
story.append(Paragraph("4. Right-click → <b>Export</b>", body_style))
story.append(Paragraph("5. Guarda como <b>pass-signing.p12</b> con contraseña", body_style))
story.append(PageBreak())

# Sección 3: WWDR Certificate
story.append(Paragraph("3. Obtener WWDR Certificate", heading_style))
story.append(Paragraph(
    "Este es el certificado intermedio de Apple que valida tu firma.",
    body_style
))
story.append(Spacer(1, 8))

story.append(Paragraph("Opción A: Descargar manualmente", subheading_style))
story.append(Paragraph(
    "Ve a: <b>https://www.apple.com/certificateauthority/</b>",
    body_style
))
story.append(Paragraph("Busca <b>Apple Worldwide Developer Relations CA 4</b>", body_style))
story.append(Paragraph("Descarga <b>AppleWWDRCA4.cer</b>", body_style))
story.append(Spacer(1, 8))

story.append(Paragraph("Opción B: Ya está en tu Mac", subheading_style))
story.append(Paragraph(
    "Es probable que ya tengas este certificado en Keychain.",
    body_style
))
story.append(Paragraph("Abre <b>Keychain Access</b> → Busca <b>Apple Worldwide Developer Relations CA 4</b>", body_style))
story.append(Paragraph("Si lo encuentras, Right-click → <b>Export</b> → Guarda como <b>AppleWWDRCA4.cer</b>", body_style))
story.append(PageBreak())

# Sección 4: APNs Private Key
story.append(Paragraph("4. Obtener APNs Private Key (.p8)", heading_style))
story.append(Paragraph(
    "Este es el certificado para enviar notificaciones push a los Wallets.",
    body_style
))
story.append(Spacer(1, 8))

story.append(Paragraph("Paso 1: Crear una Authentication Key", subheading_style))
story.append(Paragraph(
    "Ve a: <b>https://developer.apple.com/account/resources/authkeys/list</b>",
    body_style
))
story.append(Paragraph("1. Click <b>+</b> (arriba a la derecha)", body_style))
story.append(Paragraph("2. Selecciona <b>Apple Push Notifications service (APNs)</b>", body_style))
story.append(Paragraph("3. Click <b>Continue</b>", body_style))
story.append(Paragraph("4. Confirma el Team ID que aparece", body_style))
story.append(Paragraph("5. Click <b>Register</b>", body_style))
story.append(Spacer(1, 8))

story.append(Paragraph("Paso 2: Descargar la clave", subheading_style))
story.append(Paragraph("1. Te mostrará un botón <b>Download</b>", body_style))
story.append(Paragraph("2. Descarga el archivo (será <b>AuthKey_XXXXXXXXXX.p8</b>)", body_style))
story.append(Paragraph("3. Guárdalo en lugar seguro. <b>No se puede descargar de nuevo.</b>", body_style))
story.append(Spacer(1, 8))

story.append(Paragraph(
    "<b>⚠️ IMPORTANTE:</b> Este es un archivo privado. Si lo pierdes, deberás crear una nueva clave.",
    warning_style
))
story.append(Spacer(1, 8))

story.append(Paragraph("Paso 3: Anotar el Key ID", subheading_style))
story.append(Paragraph(
    "En la pantalla de Apple Dev Console verás el <b>Key ID</b> (10 caracteres).",
    body_style
))
story.append(Paragraph("Cópialo y guárdalo junto con el archivo .p8.", body_style))
story.append(PageBreak())

# Sección 5: Exportar desde Keychain
story.append(Paragraph("5. Exportar desde Keychain (si ya tienes certificados)", heading_style))
story.append(Paragraph(
    "Si ya creaste estos certificados antes, probablemente estén en tu Keychain.",
    body_style
))
story.append(Spacer(1, 8))

story.append(Paragraph("Paso a paso:", subheading_style))
story.append(Paragraph("1. Abre <b>Keychain Access</b> (Aplicaciones → Utilidades)", body_style))
story.append(Paragraph("2. En la barra de búsqueda, escribe <b>pass</b> o <b>wallet</b>", body_style))
story.append(Paragraph("3. Encontrarás <b>Wallet Signing Certificate</b> (con un icono de candado 🔒)", body_style))
story.append(Paragraph("4. Right-click → <b>Export...</b>", body_style))
story.append(Paragraph("5. Selecciona formato <b>Personal Information Exchange (.p12)</b>", body_style))
story.append(Paragraph("6. Guarda el archivo: <b>pass-signing.p12</b>", body_style))
story.append(Paragraph("7. Ingresa la contraseña que usaste al crear el certificado", body_style))
story.append(PageBreak())

# Sección 6: Notas de Seguridad
story.append(Paragraph("6. Notas de Seguridad", heading_style))

story.append(Paragraph("<b>✓ DO (Haz esto):</b>", subheading_style))
story.append(Paragraph("• Guarda los certificados en un lugar seguro", body_style))
story.append(Paragraph("• Usa contraseñas fuertes para los .p12", body_style))
story.append(Paragraph("• Nunca commitees los .p12 a git (deberán estar en .gitignore)", body_style))
story.append(Paragraph("• Nunca pastes las claves privadas en emails o chats públicos", body_style))
story.append(Paragraph("• Sube los certificados a Cloudflare como secrets (no en el código)", body_style))
story.append(Spacer(1, 8))

story.append(Paragraph("<b>✗ DON'T (No hagas esto):</b>", subheading_style))
story.append(Paragraph("• No compartas las claves privadas", body_style))
story.append(Paragraph("• No almacenes las contraseñas en archivos de texto", body_style))
story.append(Paragraph("• No uses estos certificados en múltiples aplicaciones", body_style))
story.append(Paragraph("• No dejes los .p12 en la carpeta de descargas", body_style))
story.append(PageBreak())

# Sección 7: Estructura de archivos
story.append(Paragraph("7. Estructura de Archivos Local", heading_style))
story.append(Paragraph(
    "Una vez tengas todos los certificados, guárdalos en una estructura ordenada:",
    body_style
))
story.append(Spacer(1, 8))

story.append(Paragraph(
    "~/Apple/Wallet/<br/>├── pass-signing.p12<br/>├── AppleWWDRCA4.cer<br/>├── AuthKey_XXXXXXXXXX.p8<br/>└── notes.txt (con las contraseñas, Key ID, Team ID)",
    code_style
))
story.append(Spacer(1, 8))

story.append(Paragraph(
    "<b>Nota:</b> El archivo <b>notes.txt</b> debe contener:",
    body_style
))
story.append(Paragraph("• Team ID: XXXXXXXXXX", code_style))
story.append(Paragraph("• Pass Type ID: pass.XXXXXXXXXX.fideliza", code_style))
story.append(Paragraph("• APNs Key ID: YYYYYYYYYY", code_style))
story.append(Paragraph("• Contraseña .p12: [tu_contraseña_segura]", code_style))
story.append(PageBreak())

# Sección 8: Validación
story.append(Paragraph("8. Validación de Certificados", heading_style))

story.append(Paragraph("Validar .p12", subheading_style))
story.append(Paragraph(
    "openssl pkcs12 -in pass-signing.p12 -nodes -nokeys",
    code_style
))
story.append(Paragraph("Deberías ver un certificado válido sin errores.", body_style))
story.append(Spacer(1, 8))

story.append(Paragraph("Validar .cer", subheading_style))
story.append(Paragraph(
    "openssl x509 -in AppleWWDRCA4.cer -text -noout | head -20",
    code_style
))
story.append(Paragraph("Verifica que sea un certificado de Apple válido.", body_style))
story.append(Spacer(1, 8))

story.append(Paragraph("Validar .p8", subheading_style))
story.append(Paragraph(
    "openssl pkey -in AuthKey_XXXXXXXXXX.p8 -text -noout | head",
    code_style
))
story.append(Paragraph("Verifica que sea una clave privada EC válida.", body_style))
story.append(Spacer(1, 8))

story.append(Paragraph("Próximos pasos", subheading_style))
story.append(Paragraph(
    "Una vez tengas todos estos archivos, notifica que están listos para cargarlos en el proyecto.",
    body_style
))

# Generar PDF
doc.build(story)
print(f"✅ PDF generado exitosamente en: {pdf_path}")

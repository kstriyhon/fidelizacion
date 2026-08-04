# Fideliza — Tarjetas de fidelización en Google Wallet

Producto multi-tenant de tarjetas de sellos digitales para negocios locales
(cafeterías, panaderías, restaurantes, barberías…). El cliente lleva su tarjeta en
**Google Wallet** y recibe **notificaciones push** cuando le suman un sello o
completa la tarjeta. Sin app propia, sin FCM.

Stack: TanStack Start (React 19) + Supabase + Tailwind v4 + Cloudflare Workers.

## Rutas

- `/` — landing del producto.
- `/comercio` — panel del comercio: crea tu negocio y programa, inscribe clientes, da sellos, canjea premios, comparte el QR de inscripción.
- `/unirse/:slug` — página pública donde el cliente se registra y agrega la tarjeta a Google Wallet.

## 1. Base de datos (Supabase)

El SQL **se corre a mano** en el SQL editor del dashboard de Supabase (no se aplica solo):

- `supabase/migrations/0001_loyalty_core.sql`

> Hoy comparte el mismo proyecto Supabase que Unidental (tablas con prefijo
> `loyalty_`, aisladas). A futuro: crear un proyecto Supabase propio y cambiar
> `src/lib/supabaseCredentials.ts`.
>
> ⚠️ RLS está en modo **demo permisivo** (cualquiera puede leer/escribir). Antes
> de producción real, endurecer con auth por comercio.

## 2. Google Wallet (modo real)

Sin credenciales la app corre en **modo mock**: todo el flujo funciona pero no se
emite un pase real. Para activar los pases reales y las push:

1. **Emisor**: en [Google Pay & Wallet Console](https://pay.google.com/business/console) → registra el emisor y copia el **Issuer ID** (número largo).
2. **Service Account**: en [Google Cloud Console](https://console.cloud.google.com) → habilita **Google Wallet API** → crea una service account → **Keys → JSON** (descarga; es secreto).
3. En la Wallet Console → **Usuarios** → agrega el `client_email` del JSON con rol Editor.

### Variables de entorno (secretas)

| Variable | Valor |
|---|---|
| `GOOGLE_WALLET_ISSUER_ID` | El Issuer ID (número). |
| `GOOGLE_WALLET_SA_EMAIL` | `client_email` del JSON. |
| `GOOGLE_WALLET_SA_PRIVATE_KEY` | `private_key` del JSON (con `\n` escapados o multilínea). |
| `PUBLIC_APP_ORIGIN` | Origen público de la app, ej. `https://tarjeta-fidelizacion.<sub>.workers.dev`. |

**Local (`vite dev`)**: expórtalas en tu shell antes de `npm run dev`, o ponlas en
un `.env` cargado por tu entorno. (No se versiona: `.gitignore` ya excluye `.env`,
`.dev.vars` y los `*.json` de service account.)

**Cloudflare Workers**: setéalas como *secrets* de runtime:

```bash
wrangler secret put GOOGLE_WALLET_ISSUER_ID
wrangler secret put GOOGLE_WALLET_SA_EMAIL
wrangler secret put GOOGLE_WALLET_SA_PRIVATE_KEY
wrangler secret put PUBLIC_APP_ORIGIN
```

## 3. Correr

```bash
npm install
npm run dev      # http://localhost:8080
```

Deploy a Cloudflare: igual que Unidental (`npm run build` genera el Worker con Nitro
preset `cloudflare-module`; Workers Builds despliega desde `main`).

## Arquitectura Wallet (dónde está cada cosa)

- `src/lib/wallet/config.server.ts` — lee credenciales de env; decide live vs mock.
- `src/lib/wallet/crypto.server.ts` — firma RS256 con Web Crypto (Node + Workers).
- `src/lib/wallet/google.server.ts` — crea/actualiza LoyaltyClass/Object, link "Add to Wallet", push.
- `src/lib/server/loyalty.server.ts` — server functions: inscribir, sellar, canjear, aprovisionar.

# Fideliza — Tarjetas de fidelización en Google Wallet

SaaS de tarjetas de sellos digitales para negocios locales (cafeterías, panaderías,
restaurantes, barberías…). El cliente lleva su tarjeta en **Google Wallet (Android)**
y recibe **notificaciones push** cuando le suman un sello o completa la tarjeta.
Sin app propia, sin FCM.

**Stack:** TanStack Start (React 19) · Supabase · Tailwind v4 · Cloudflare Workers.

## Funcionalidades

- 🏪 **Multi-comercio** con login por negocio (Supabase Auth) y panel de administrador.
- 🎟️ **Tarjeta real en Google Wallet** — inscripción pública por QR/enlace.
- ➕ **Sellos** desde el panel o **escaneando el QR** del cliente con la cámara.
- 🔔 **Notificaciones push**: mensaje personalizable por sello, mensaje puntual por
  cliente (cumpleaños/promo) y **aviso masivo** a todos.
- 🎁 **Canje de premios** al completar la tarjeta.
- 🖼️ **Logo propio** del comercio (Supabase Storage) en la tarjeta.
- 🔒 **Seguridad**: RLS + service-role; cada comercio solo accede a sus datos.

## Configuración

Ver **[SETUP.md](SETUP.md)** para la puesta en marcha completa (Supabase, Google
Wallet, secretos, despliegue).

Secretos necesarios (nunca en el repo):

- `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_EMAIL`, `GOOGLE_WALLET_SA_PRIVATE_KEY`
- `PUBLIC_APP_ORIGIN`
- `SUPABASE_SERVICE_ROLE_KEY`

En local van en `.dev.vars` (+ `google-wallet-sa.json`), ambos gitignored. En
Cloudflare, como *secrets* de runtime (`wrangler secret put`).

```bash
npm install
npm run dev        # http://localhost:8080
npm run build && npx wrangler deploy   # desplegar a Cloudflare
```

Las migraciones SQL (`supabase/migrations/`) se corren a mano en el SQL editor de Supabase.

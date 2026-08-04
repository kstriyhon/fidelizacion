// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// --- Credenciales de Google Wallet para DEV LOCAL ---------------------------
// vite.config corre en Node (mismo proceso que el dev server), así que al
// escribir en process.env aquí, las server functions lo ven en runtime durante
// `vite dev`. Cargamos la service account desde el JSON (gitignored) para correr
// en modo LIVE localmente.
// En Cloudflare este archivo NO existe (gitignored) → este bloque se salta, y el
// runtime usa los *secrets* de wrangler (process.env). No se hornea ningún
// secreto en el bundle: config.server.ts los lee en runtime, no en build.
try {
  const saPath = "./google-wallet-sa.json";
  if (existsSync(saPath) && !process.env.GOOGLE_WALLET_SA_EMAIL) {
    const sa = JSON.parse(readFileSync(saPath, "utf8"));
    process.env.GOOGLE_WALLET_SA_EMAIL = sa.client_email;
    process.env.GOOGLE_WALLET_SA_PRIVATE_KEY = sa.private_key;
    process.env.GOOGLE_WALLET_ISSUER_ID ||= "3388000000023178109";
    process.env.PUBLIC_APP_ORIGIN ||= "http://localhost:8080";
  }
} catch (e) {
  console.warn("[wallet] no se pudo cargar google-wallet-sa.json:", e);
}

// Carga .dev.vars (formato KEY=VALUE) en process.env para dev local — sobre todo
// SUPABASE_SERVICE_ROLE_KEY. En Cloudflare no existe este archivo (gitignored);
// allí las vars vienen de los *secrets* de runtime.
try {
  if (existsSync("./.dev.vars")) {
    for (const line of readFileSync("./.dev.vars", "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
} catch (e) {
  console.warn("[env] no se pudo cargar .dev.vars:", e);
}

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  // Deploy con Nitro, preset "cloudflare-module": genera el Worker de Cloudflare
  // en dist/ junto con su config de deploy (wrangler.json) gracias a
  // deployConfig:true que aplica el plugin de Lovable. Esto es lo que despliega
  // Cloudflare (Workers Builds) al hacer `npm run build`.
  nitro: { preset: "cloudflare-module" },
});

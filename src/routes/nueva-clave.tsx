import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Stamp, ArrowLeft, AlertCircle, KeyRound } from "lucide-react";

import { useSession, updatePassword } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/nueva-clave")({
  component: NuevaClavePage,
});

/**
 * Supabase devuelve los fallos del enlace en el FRAGMENTO de la url
 * (#error=...&error_description=...), no en la query. El caso habitual es
 * `otp_expired`: el enlace es de un solo uso y algunos clientes de correo lo
 * gastan al previsualizarlo.
 */
function readHashError(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const code = params.get("error_code");
  if (!params.get("error") && !code) return null;
  if (code === "otp_expired") {
    return "El enlace ya caducó o se usó antes. Pide uno nuevo.";
  }
  return params.get("error_description")?.replace(/\+/g, " ") ?? "El enlace no es válido.";
}

function NuevaClavePage() {
  const navigate = useNavigate();
  const session = useSession();

  const [hashError] = useState(readHashError);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  // El cliente de Supabase tarda un instante en canjear el token del fragmento;
  // sin esta espera mostraríamos "enlace inválido" durante ese parpadeo.
  const [graceOver, setGraceOver] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setGraceOver(true), 3000);
    return () => clearTimeout(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      return toast.error("La contraseña debe tener al menos 6 caracteres.");
    }
    if (password !== confirm) {
      return toast.error("Las dos contraseñas no coinciden.");
    }
    setBusy(true);
    try {
      await updatePassword(password);
      toast.success("Contraseña actualizada. Ya puedes entrar.");
      navigate({ to: "/comercio" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo actualizar la contraseña");
    } finally {
      setBusy(false);
    }
  }

  const linkFailed = hashError || (graceOver && !session);

  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 px-6">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Inicio
        </Link>
        <div className="rounded-xl border bg-card p-6">
          <div className="flex items-center gap-2 font-bold">
            <Stamp className="h-6 w-6 text-primary" /> Fideliza
          </div>

          {linkFailed ? (
            <>
              <h1 className="mt-4 text-lg font-bold">Enlace no válido</h1>
              <div className="mt-4 flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <p className="text-sm">
                  {hashError ?? "No pudimos validar el enlace. Puede haber caducado."}
                </p>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Si tu correo previsualiza los enlaces, copia la dirección del botón y pégala en el
                navegador en vez de hacer clic: algunos clientes gastan el enlace al abrirlo solos.
              </p>
              <Button asChild className="mt-4 w-full">
                <Link to="/login">Pedir un enlace nuevo</Link>
              </Button>
            </>
          ) : !session ? (
            <>
              <h1 className="mt-4 text-lg font-bold">Validando enlace…</h1>
              <p className="mt-1 text-sm text-muted-foreground">Un momento.</p>
            </>
          ) : (
            <>
              <h1 className="mt-4 text-lg font-bold">Crea tu contraseña nueva</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Para <span className="font-medium text-foreground">{session.user.email}</span>
              </p>

              <form onSubmit={submit} className="mt-5 grid gap-3">
                <div className="grid gap-1.5">
                  <Label>Contraseña nueva</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Repítela</Label>
                  <Input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </div>
                <Button type="submit" size="lg" disabled={busy} className="mt-1">
                  <KeyRound className="mr-2 h-4 w-4" />
                  {busy ? "Guardando…" : "Guardar contraseña"}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

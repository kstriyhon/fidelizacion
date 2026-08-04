import { useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Stamp, ArrowLeft } from "lucide-react";

import { signIn, signUp } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || password.length < 6) {
      return toast.error("Ingresa un email y una contraseña de al menos 6 caracteres.");
    }
    setBusy(true);
    try {
      if (mode === "in") {
        await signIn(email, password);
        navigate({ to: "/comercio" });
      } else {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          toast.success("Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.");
          setMode("in");
        } else {
          navigate({ to: "/comercio" });
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error de autenticación");
    } finally {
      setBusy(false);
    }
  }

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
          <h1 className="mt-4 text-lg font-bold">
            {mode === "in" ? "Entra a tu panel" : "Crea tu cuenta de comercio"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "in"
              ? "Gestiona tu programa de sellos y tus clientes."
              : "Regístrate para crear tu tarjeta de fidelización."}
          </p>

          <form onSubmit={submit} className="mt-5 grid gap-3">
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tunegocio@correo.com"
                autoComplete="email"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Contraseña</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "in" ? "current-password" : "new-password"}
              />
            </div>
            <Button type="submit" size="lg" disabled={busy} className="mt-1">
              {busy ? "Procesando…" : mode === "in" ? "Iniciar sesión" : "Crear cuenta"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === "in" ? "up" : "in")}
            className="mt-4 text-sm text-primary hover:underline"
          >
            {mode === "in"
              ? "¿No tienes cuenta? Regístrate"
              : "¿Ya tienes cuenta? Inicia sesión"}
          </button>
        </div>
      </div>
    </div>
  );
}

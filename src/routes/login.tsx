import { useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Stamp, ArrowLeft, MailCheck, Eye, EyeOff } from "lucide-react";

import { signIn, signUp, requestPasswordReset } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

type Mode = "in" | "up" | "reset";

const TITLES: Record<Mode, { title: string; subtitle: string }> = {
  in: {
    title: "Entra a tu panel",
    subtitle: "Gestiona tu programa de sellos y tus clientes.",
  },
  up: {
    title: "Crea tu cuenta de comercio",
    subtitle: "Regístrate para crear tu tarjeta de fidelización.",
  },
  reset: {
    title: "Recupera tu contraseña",
    subtitle: "Te enviamos un enlace para crear una nueva.",
  },
};

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function switchTo(next: Mode) {
    setMode(next);
    setSent(false);
    setPassword("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (mode === "reset") {
      if (!email) return toast.error("Escribe tu email.");
      setBusy(true);
      try {
        await requestPasswordReset(email);
        setSent(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo enviar el correo");
      } finally {
        setBusy(false);
      }
      return;
    }

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
          switchTo("in");
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

  const { title, subtitle } = TITLES[mode];

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
          <h1 className="mt-4 text-lg font-bold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

          {/* Tras pedir el enlace no repetimos el formulario: evita reenvíos en
              cadena y deja claro que el siguiente paso está en el correo. */}
          {mode === "reset" && sent ? (
            <div className="mt-5 grid gap-4">
              <div className="flex gap-3 rounded-lg border bg-muted/50 p-4">
                <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="text-sm">
                  <p className="font-medium">Revisa tu correo</p>
                  <p className="mt-1 text-muted-foreground">
                    Si <span className="font-medium text-foreground">{email}</span> tiene cuenta, le
                    llega un enlace para crear una contraseña nueva.
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                ¿No llega? Mira en spam. Y si tu correo previsualiza los enlaces, copia la dirección
                del botón y pégala en el navegador en lugar de hacer clic: algunos clientes de correo
                gastan el enlace al abrirlo por su cuenta.
              </p>
              <Button variant="outline" onClick={() => switchTo("in")}>
                Volver al inicio de sesión
              </Button>
            </div>
          ) : (
            <>
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

                {mode !== "reset" && (
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between">
                      <Label>Contraseña</Label>
                      {mode === "in" && (
                        <button
                          type="button"
                          onClick={() => switchTo("reset")}
                          className="text-xs text-primary hover:underline"
                        >
                          ¿Olvidaste tu contraseña?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        autoComplete={mode === "in" ? "current-password" : "new-password"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                )}

                <Button type="submit" size="lg" disabled={busy} className="mt-1">
                  {busy
                    ? "Procesando…"
                    : mode === "in"
                      ? "Iniciar sesión"
                      : mode === "up"
                        ? "Crear cuenta"
                        : "Enviarme el enlace"}
                </Button>
              </form>

              <button
                type="button"
                onClick={() => switchTo(mode === "in" ? "up" : "in")}
                className="mt-4 text-sm text-primary hover:underline"
              >
                {mode === "in"
                  ? "¿No tienes cuenta? Regístrate"
                  : mode === "up"
                    ? "¿Ya tienes cuenta? Inicia sesión"
                    : "Volver al inicio de sesión"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

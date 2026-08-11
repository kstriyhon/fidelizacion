import { useState, useEffect } from "react";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Dumbbell, CheckCircle2, ArrowRight, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { supabase } from "@/lib/supabase";
import type { Business, Member, Program } from "@/lib/data";
import { enrollGymMemberFn } from "@/lib/gymActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/gym-inscribirse/$slug")({
  component: GymEnrollPage,
});

function GymEnrollPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();

  const [business, setBusiness] = useState<Business | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<"form" | "membership" | "success">("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ member: Member; dashboardUrl: string } | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: businessData } = await supabase
          .from("loyalty_businesses")
          .select("*")
          .eq("slug", slug)
          .maybeSingle();

        if (!businessData) throw new Error("Negocio no encontrado");

        const { data: programData } = await supabase
          .from("loyalty_programs")
          .select("*")
          .eq("business_id", businessData.id)
          .eq("active", true)
          .order("created_at")
          .limit(1)
          .maybeSingle();

        if (!programData) throw new Error("Programa no encontrado");

        setBusiness(businessData as Business);
        setProgram(programData as Program);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Cargando...</div>
      </div>
    );
  }

  if (error || !business || !program) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || "No se encontró el negocio"}</p>
          <Button onClick={() => navigate({ to: "/" })}>Volver</Button>
        </div>
      </div>
    );
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Escribe tu nombre completo");
      return;
    }
    if (!phone.trim()) {
      toast.error("Escribe tu número de teléfono");
      return;
    }
    setStep("membership");
  };

  const handleSelectMembership = async () => {
    setSaving(true);
    try {
      const res = await enrollGymMemberFn({
        data: {
          fullName: name.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          programId: program.id,
        },
      });

      const dashboardUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/gym-member/${res.member.id}`;
      setResult({ member: res.member, dashboardUrl });
      setStep("success");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al inscribirse");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-primary/5 px-4 py-8">
      <div className="mx-auto max-w-md">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <div className="flex items-center gap-2">
            <div
              className="rounded-lg p-3"
              style={{ backgroundColor: business.brand_color + "20" }}
            >
              {business.logo_url ? (
                <img src={business.logo_url} alt={business.name} className="h-8 w-8" />
              ) : (
                <Dumbbell className="h-8 w-8" style={{ color: business.brand_color }} />
              )}
            </div>
            <div>
              <h1 className="font-bold text-xl">{business.name}</h1>
              <p className="text-xs text-muted-foreground">{program.name}</p>
            </div>
          </div>
        </div>

        {/* Step 1: Formulario */}
        {step === "form" && (
          <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
            <div>
              <h2 className="text-lg font-bold">Bienvenido</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Completa tus datos para acceder a tu dashboard personal
              </p>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <Label htmlFor="name">Nombre completo</Label>
                <Input
                  id="name"
                  placeholder="Tu nombre"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="phone">Teléfono</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+506 8888 1234"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="email">Email (opcional)</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="correo@ejemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-2"
                />
              </div>

              <Button type="submit" className="w-full" size="lg">
                Continuar <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </form>

            <div className="border-t pt-4 text-xs text-muted-foreground space-y-1">
              <p>✓ Acceso inmediato a tu dashboard</p>
              <p>✓ Check-in y control de asistencia</p>
              <p>✓ Sistema de referidos</p>
            </div>
          </div>
        )}

        {/* Step 2: Confirmación */}
        {step === "membership" && (
          <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
            <div>
              <h2 className="text-lg font-bold">Confirmar inscripción</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Hola {name.split(" ")[0]} 👋 ¿Todo correcto?
              </p>
            </div>

            <div className="bg-muted/50 p-4 rounded space-y-2 text-sm">
              <p><strong>Nombre:</strong> {name}</p>
              <p><strong>Teléfono:</strong> {phone}</p>
              {email && <p><strong>Email:</strong> {email}</p>}
            </div>

            <div className="space-y-2">
              <Button onClick={handleSelectMembership} disabled={saving} className="w-full">
                {saving ? "Procesando..." : "Crear mi cuenta"}
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setStep("form")}
                disabled={saving}
              >
                ← Atrás
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Éxito */}
        {step === "success" && result && (
          <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
            <div className="flex justify-center">
              <div className="rounded-full bg-green-500/20 p-4">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
            </div>

            <div className="text-center space-y-2">
              <h2 className="text-lg font-bold">¡Bienvenido!</h2>
              <p className="text-sm text-muted-foreground">
                Tu cuenta ha sido creada. Accede a tu dashboard.
              </p>
            </div>

            <div className="flex justify-center py-4">
              <div className="bg-white p-3 rounded-lg">
                <QRCodeSVG
                  value={result.dashboardUrl}
                  size={150}
                  level="H"
                  includeMargin
                />
              </div>
            </div>

            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={() => (window.location.href = result.dashboardUrl)}
              >
                Ir a mi dashboard
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  const text = `¡Acabo de inscribirme en ${business.name}! ${result.dashboardUrl}`;
                  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
                }}
              >
                <Share2 className="w-4 h-4 mr-2" />
                Compartir
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

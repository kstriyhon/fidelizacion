import { useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/gym-inscribirse/$slug")({
  loader: async ({ params }) => {
    const { data: business } = await supabase
      .from("loyalty_businesses")
      .select("*")
      .eq("slug", params.slug)
      .maybeSingle();

    if (!business) throw notFound();

    const { data: program } = await supabase
      .from("loyalty_programs")
      .select("*")
      .eq("business_id", business.id)
      .eq("active", true)
      .order("created_at")
      .limit(1)
      .maybeSingle();

    if (!program) throw notFound();

    const { data: config } = await supabase
      .from("gym_program_config")
      .select("*")
      .eq("program_id", program.id)
      .maybeSingle();

    return {
      business: business as Business,
      program: program as Program,
      config: config ?? null,
    };
  },
  component: GymEnrollPage,
});

function GymEnrollPage() {
  const { business, program, config } = Route.useLoaderData();
  const navigate = useNavigate();

  const [step, setStep] = useState<"form" | "membership" | "success">("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [selectedMembership, setSelectedMembership] = useState<
    "monthly" | "quarterly" | "annual" | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ member: Member; dashboardUrl: string } | null>(null);

  const membershipOptions = [
    {
      type: "monthly" as const,
      label: "Mensual",
      duration: config?.monthly_days ?? 30,
      price: config?.monthly_price,
      icon: "📅",
    },
    {
      type: "quarterly" as const,
      label: "Trimestral",
      duration: config?.quarterly_days ?? 90,
      price: config?.quarterly_price,
      icon: "📊",
    },
    {
      type: "annual" as const,
      label: "Anual",
      duration: config?.annual_days ?? 365,
      price: config?.annual_price,
      icon: "⭐",
    },
  ];

  async function handleFormSubmit(e: React.FormEvent) {
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
  }

  async function handleSelectMembership(type: "monthly" | "quarterly" | "annual") {
    setSelectedMembership(type);
    setSaving(true);
    try {
      const res = await enrollGymMemberFn({
        fullName: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        programId: program.id,
      });

      const dashboardUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/gym/${res.member.id}`;
      setResult({ member: res.member, dashboardUrl });
      setStep("success");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al inscribirse");
      setSelectedMembership(null);
    } finally {
      setSaving(false);
    }
  }

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
                  placeholder="Juan García Ramírez"
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

            {/* Info */}
            <div className="border-t pt-4 text-xs text-muted-foreground space-y-1">
              <p>✓ Acceso inmediato a tu dashboard</p>
              <p>✓ Check-in y control de asistencia</p>
              <p>✓ Sistema de referidos con recompensas</p>
            </div>
          </div>
        )}

        {/* Step 2: Seleccionar Membresía */}
        {step === "membership" && (
          <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
            <div>
              <h2 className="text-lg font-bold">Elige tu membresía</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Hola {name.split(" ")[0]} 👋 Selecciona el plan que se ajuste a ti
              </p>
            </div>

            <div className="space-y-3">
              {membershipOptions.map((option) => (
                <button
                  key={option.type}
                  onClick={() => handleSelectMembership(option.type)}
                  disabled={saving || selectedMembership === option.type}
                  className={`w-full rounded-lg border-2 p-4 transition-all text-left ${
                    selectedMembership === option.type
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  } ${saving ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xl">{option.icon}</span>
                        <p className="font-semibold">{option.label}</p>
                        {option.type === "annual" && (
                          <span className="text-xs bg-green-500/20 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">
                            Mejor valor
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{option.duration} días de acceso</p>
                    </div>
                    {option.price && (
                      <p className="text-lg font-bold" style={{ color: business.brand_color }}>
                        ${option.price}
                      </p>
                    )}
                  </div>

                  {selectedMembership === option.type && saving && (
                    <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                      <div className="animate-spin">⏳</div>
                      <span>Procesando...</span>
                    </div>
                  )}
                </button>
              ))}
            </div>

            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setStep("form")}
              disabled={saving}
            >
              ← Atrás
            </Button>
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
              <h2 className="text-lg font-bold">¡Bienvenido al gimnasio!</h2>
              <p className="text-sm text-muted-foreground">
                Tu cuenta ha sido creada exitosamente. Accede a tu dashboard usando el QR o link abajo.
              </p>
            </div>

            {/* QR Code */}
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

            {/* Dashboard Link */}
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Tu dashboard:</p>
              <input
                type="text"
                readOnly
                value={result.dashboardUrl}
                className="w-full text-xs bg-background border rounded px-2 py-1 font-mono"
              />
            </div>

            {/* Buttons */}
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={() => window.location.href = result.dashboardUrl}
              >
                Ir a mi dashboard
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  const text = `¡Acabo de inscribirme en ${business.name}! Accede a tu dashboard: ${result.dashboardUrl}`;
                  window.open(
                    `https://wa.me/?text=${encodeURIComponent(text)}`,
                    "_blank",
                  );
                }}
              >
                <Share2 className="w-4 h-4 mr-2" />
                Compartir por WhatsApp
              </Button>
            </div>

            {/* Data Summary */}
            <div className="border-t pt-4 space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Nombre:</span>
                <span className="font-medium text-foreground">{result.member.full_name}</span>
              </div>
              <div className="flex justify-between">
                <span>ID Miembro:</span>
                <span className="font-mono text-[10px]">{result.member.id.slice(0, 8)}...</span>
              </div>
              <div className="flex justify-between">
                <span>Membresía:</span>
                <span className="font-medium text-foreground">Activa</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

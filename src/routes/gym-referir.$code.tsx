import { useState } from "react";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Dumbbell, CheckCircle2, ArrowRight, Gift, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { getReferralInscriptionDataFn, enrollGymMemberFn } from "@/lib/gymActions";
import type { Member } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/gym-referir/$code")({
  loader: async ({ params }) => {
    try {
      const data = await getReferralInscriptionDataFn({ referralCode: params.code });
      return data;
    } catch (err) {
      console.error("Error loading referral data:", err);
      throw notFound();
    }
  },
  component: GymReferralEnrollPage,
});

function GymReferralEnrollPage() {
  const { referral, referrer, programId } = Route.useLoaderData();
  const navigate = useNavigate();

  const [step, setStep] = useState<"form" | "processing" | "success">("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ member: Member; dashboardUrl: string } | null>(null);

  const rewardLabel =
    referral.reward_type === "discount"
      ? `${referral.reward_value}% de descuento`
      : referral.reward_type === "stamps"
        ? `${referral.reward_value} sellos`
        : `${referral.reward_value} días gratis`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Escribe tu nombre completo");
      return;
    }
    if (!phone.trim()) {
      toast.error("Escribe tu número de teléfono");
      return;
    }

    setSaving(true);
    setStep("processing");

    try {
      const res = await enrollGymMemberFn({
        fullName: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        programId,
        referralCode: referral.referral_code,
      });

      const dashboardUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/gym/${res.member.id}`;
      setResult({ member: res.member, dashboardUrl });
      setStep("success");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al inscribirse");
      setStep("form");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-primary/5 px-4 py-8">
      <div className="mx-auto max-w-md">
        {/* Header con referrer */}
        <div className="mb-8 text-center space-y-2">
          <div className="flex justify-center mb-4">
            <div
              className="rounded-lg p-3"
              style={{ backgroundColor: referrer.loyalty_businesses?.brand_color + "20" }}
            >
              {referrer.loyalty_businesses?.logo_url ? (
                <img
                  src={referrer.loyalty_businesses.logo_url}
                  alt={referrer.loyalty_businesses.name}
                  className="h-8 w-8"
                />
              ) : (
                <Dumbbell
                  className="h-8 w-8"
                  style={{ color: referrer.loyalty_businesses?.brand_color }}
                />
              )}
            </div>
          </div>
          <h1 className="text-2xl font-bold">{referrer.loyalty_businesses?.name}</h1>
          <p className="text-muted-foreground text-sm">
            {referrer.full_name} te invitó a unirte
          </p>
        </div>

        {/* Reward Badge */}
        <div className="mb-6 rounded-xl border-2 border-primary/50 bg-primary/5 p-4 text-center space-y-2">
          <div className="flex justify-center">
            <Gift className="w-6 h-6 text-primary" />
          </div>
          <p className="text-sm font-medium">Recompensa especial</p>
          <p className="text-lg font-bold">{rewardLabel}</p>
          <p className="text-xs text-muted-foreground">Se activará cuando completes tu membresía</p>
        </div>

        {/* Step 1: Formulario */}
        {step === "form" && (
          <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
            <div>
              <h2 className="text-lg font-bold">Únete ahora</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Completa tus datos para acceder a tu membresía
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="name">Nombre completo</Label>
                <Input
                  id="name"
                  placeholder="Tu nombre"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2"
                  disabled={saving}
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
                  disabled={saving}
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
                  disabled={saving}
                />
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={saving}>
                {saving ? "Procesando..." : "Activar mi membresía"}
                {!saving && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>
            </form>

            <div className="border-t pt-4 space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>✓</span>
                <span>Tu recompensa se activará automáticamente</span>
              </div>
              <div className="flex items-center gap-2">
                <span>✓</span>
                <span>Acceso inmediato a tu dashboard</span>
              </div>
              <div className="flex items-center gap-2">
                <span>✓</span>
                <span>Control de asistencia y referidos</span>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Procesando */}
        {step === "processing" && (
          <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4 text-center">
            <div className="flex justify-center">
              <div className="animate-spin">⏳</div>
            </div>
            <p className="font-medium">Procesando tu inscripción...</p>
            <p className="text-sm text-muted-foreground">
              Estamos activando tu membresía y procesando tu recompensa
            </p>
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
              <h2 className="text-lg font-bold">¡Bienvenido! 🎉</h2>
              <p className="text-sm text-muted-foreground">
                Tu membresía está activa y tu recompensa ha sido aplicada
              </p>
            </div>

            {/* Reward Confirmation */}
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center">
              <p className="text-sm text-muted-foreground mb-1">Tu recompensa:</p>
              <p className="text-lg font-bold text-green-600">{rewardLabel}</p>
            </div>

            {/* QR Code */}
            <div className="flex justify-center py-4">
              <div className="bg-white p-3 rounded-lg">
                <QRCodeSVG value={result.dashboardUrl} size={150} level="H" includeMargin />
              </div>
            </div>

            {/* Buttons */}
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
                  const text = `¡Acabo de inscribirme en ${referrer.loyalty_businesses?.name}! Usa este código para obtener ${rewardLabel}: ${referral.referral_code}`;
                  window.open(
                    `https://wa.me/?text=${encodeURIComponent(text)}`,
                    "_blank",
                  );
                }}
              >
                <Share2 className="w-4 h-4 mr-2" />
                Compartir con otros
              </Button>
            </div>

            {/* Referrer Info */}
            <div className="border-t pt-4">
              <p className="text-xs text-muted-foreground mb-3">Gracias a tu referidor:</p>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="font-medium text-sm">{referrer.full_name}</p>
                <p className="text-xs text-muted-foreground">También recibió su recompensa</p>
              </div>
            </div>

            {/* Data Summary */}
            <div className="space-y-1 text-xs text-muted-foreground pt-4">
              <div className="flex justify-between">
                <span>Nombre:</span>
                <span className="font-medium text-foreground">{result.member.full_name}</span>
              </div>
              <div className="flex justify-between">
                <span>ID Miembro:</span>
                <span className="font-mono text-[10px]">{result.member.id.slice(0, 8)}...</span>
              </div>
              <div className="flex justify-between">
                <span>Código usado:</span>
                <span className="font-mono">{referral.referral_code}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

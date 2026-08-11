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
      const data = await getReferralInscriptionDataFn({ data: { referralCode: params.code } });
      return data;
    } catch (err) {
      console.error("Error loading referral:", err);
      throw notFound();
    }
  },
  component: GymReferralEnrollPage,
});

function GymReferralEnrollPage() {
  const loaderData = Route.useLoaderData() as any;
  const navigate = useNavigate();

  const [step, setStep] = useState<"form" | "processing" | "success">("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ member: Member; dashboardUrl: string } | null>(null);

  if (!loaderData || !loaderData.referral) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Código de referido no encontrado</p>
          <Button onClick={() => navigate({ to: "/" })}>Volver</Button>
        </div>
      </div>
    );
  }

  const { referral, referrer } = loaderData;

  const rewardLabel =
    referral.reward_type === "discount"
      ? `${referral.reward_value}% de descuento`
      : referral.reward_type === "stamps"
        ? `${referral.reward_value} sellos`
        : `${referral.reward_value} días gratis`;

  const handleSubmit = async (e: React.FormEvent) => {
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
        data: {
          fullName: name.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          programId: loaderData.programId,
          referralCode: referral.referral_code,
        },
      });

      const dashboardUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/gym-member/${res.member.id}`;
      setResult({ member: res.member, dashboardUrl });
      setStep("success");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al inscribirse");
      setStep("form");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-primary/5 px-4 py-8">
      <div className="mx-auto max-w-md">
        {/* Header */}
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

        {/* Reward */}
        <div className="mb-6 rounded-xl border-2 border-primary/50 bg-primary/5 p-4 text-center space-y-2">
          <Gift className="w-6 h-6 text-primary mx-auto" />
          <p className="text-sm font-medium">Recompensa especial</p>
          <p className="text-lg font-bold">{rewardLabel}</p>
        </div>

        {/* Step 1: Form */}
        {step === "form" && (
          <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
            <div>
              <h2 className="text-lg font-bold">Únete ahora</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Completa tus datos para activar tu membresía
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
          </div>
        )}

        {/* Step 2: Processing */}
        {step === "processing" && (
          <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4 text-center">
            <div className="animate-spin">⏳</div>
            <p className="font-medium">Procesando tu inscripción...</p>
          </div>
        )}

        {/* Step 3: Success */}
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

            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center">
              <p className="text-sm text-muted-foreground mb-1">Tu recompensa:</p>
              <p className="text-lg font-bold text-green-600">{rewardLabel}</p>
            </div>

            <div className="flex justify-center py-4">
              <div className="bg-white p-3 rounded-lg">
                <QRCodeSVG value={result.dashboardUrl} size={150} level="H" includeMargin />
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
                  const text = `¡Acabo de inscribirme en ${referrer.loyalty_businesses?.name}! ${result.dashboardUrl}`;
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

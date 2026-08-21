import { useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { toast } from "sonner";
import { Wallet, CheckCircle2, Apple } from "lucide-react";

import { supabase } from "@/lib/supabase";
import type { Business, Member, Program } from "@/lib/data";
import { enrollMemberFn } from "@/lib/loyaltyActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoyaltyCard } from "@/components/LoyaltyCard";

export const Route = createFileRoute("/unirse/$slug")({
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
    return { business: business as Business, program: program as Program };
  },
  component: JoinPage,
});

function JoinPage() {
  const { business, program } = Route.useLoaderData();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ member: Member; saveUrl: string | null; mock: boolean } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return toast.error("Escribe tu nombre");
    setSaving(true);
    try {
      const res = await enrollMemberFn({
        data: { programId: program.id, full_name: name.trim(), phone: phone.trim() || undefined },
      });
      setResult(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo inscribir");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 px-6 py-10">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex justify-center">
          <LoyaltyCard
            businessName={business.name}
            programName={program.name}
            rewardDescription={program.reward_description}
            stamps={result?.member.stamps ?? 0}
            stampsRequired={program.stamps_required}
            brandColor={business.brand_color}
            logoUrl={business.logo_url}
            memberName={result?.member.full_name}
            memberId={result?.member.id}
          />
        </div>

        {!result ? (
          <form onSubmit={submit} className="rounded-xl border bg-card p-6">
            <h1 className="text-lg font-bold">Únete a {business.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Regístrate y llévate tu tarjeta digital. Junta {program.stamps_required} sellos
              y gana: {program.reward_description}.
            </p>
            <div className="mt-4 grid gap-3">
              <div className="grid gap-1.5">
                <Label>Nombre</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" />
              </div>
              <div className="grid gap-1.5">
                <Label>WhatsApp (opcional)</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+57 300 000 0000" />
              </div>
              <Button type="submit" size="lg" disabled={saving} className="mt-1">
                {saving ? "Creando tu tarjeta…" : "Obtener mi tarjeta"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="rounded-xl border bg-card p-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
            <h1 className="mt-2 text-lg font-bold">¡Listo, {result.member.full_name}!</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tu tarjeta está creada. Agrégala a tu Wallet digital.
            </p>

            {result.saveUrl ? (
              <div className="mt-4 flex flex-col gap-3">
                <a href={result.saveUrl} target="_blank" rel="noreferrer" className="block w-full">
                  <Button size="lg" variant="default" className="w-full gap-2">
                    <Wallet className="h-5 w-5" /> Añadir a Google Wallet
                  </Button>
                </a>
                <Button size="lg" variant="outline" className="w-full gap-2" disabled>
                  <Apple className="h-5 w-5" /> Añadir a Apple Wallet (próximamente)
                </Button>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                <Wallet className="mx-auto mb-2 h-6 w-6" />
                Modo demo: los pases reales se activan cuando el negocio configure sus credenciales.
                Tu tarjeta ya quedó registrada.
              </div>
            )}

            <p className="mt-4 text-xs text-muted-foreground">
              Muestra el código QR de tu tarjeta en cada visita para sumar sellos.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

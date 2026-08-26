import { createFileRoute, Link } from "@tanstack/react-router";
import { Stamp, BellRing, Wallet, QrCode, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoyaltyCard } from "@/components/LoyaltyCard";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-bold">
          <Stamp className="h-6 w-6 text-primary" />
          Fideliza
        </div>
        <Link to="/comercio">
          <Button size="sm">Panel del comercio</Button>
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-12 md:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Wallet className="h-3.5 w-3.5" /> Para Google y Apple Wallet
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">
            La tarjeta de sellos de tu negocio, en el celular del cliente
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Reemplaza el cartón de sellos por una tarjeta digital en Google y Apple Wallet.
            Suma sellos por visita, envía notificaciones push y haz que vuelvan —
            sin desarrollar una app.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/comercio">
              <Button size="lg" className="gap-2">
                Crear mi tarjeta <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Ideal para cafeterías, panaderías, restaurantes, barberías, peluquerías…
          </p>
        </div>

        <div className="flex justify-center">
          <LoyaltyCard
            businessName="Panadería La Espiga"
            programName="Tarjeta de café"
            rewardDescription="Un café gratis"
            stamps={7}
            stampsRequired={10}
            brandColor="#7c3aed"
            memberName="Cliente demo"
            memberId="demo-preview"
          />
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              icon: Stamp,
              title: "Sellos por visita",
              body: "Configura “N sellos = premio”. El comercio suma un sello con un toque o escaneando el QR del cliente.",
            },
            {
              icon: BellRing,
              title: "Notificaciones push",
              body: "Cuando sumas un sello o completa la tarjeta, Google le manda una notificación al celular. Sin FCM ni app.",
            },
            {
              icon: QrCode,
              title: "Inscripción con un QR",
              body: "El cliente escanea un QR, pone su nombre y agrega la tarjeta a Google y Apple Wallet en segundos.",
            },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6">
              <f.icon className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-center text-xs text-muted-foreground">
        Fideliza · Producto de fidelización para negocios locales
      </footer>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { Stamp, Check, ArrowRight, ArrowLeft } from "lucide-react";

import { listPublicPlansFn } from "@/lib/loyaltyActions";
import type { Plan } from "@/lib/data";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/planes")({
  // Los planes se cargan en el servidor: la página es pública y así los precios
  // salen ya en el HTML, sin parpadeo y visibles para buscadores.
  loader: async () => ({ plans: await listPublicPlansFn({ data: {} }) }),
  component: PlanesPage,
});

/** 100000 -> "$100.000". Los precios se guardan en pesos enteros, sin decimales. */
function formatearCOP(pesos: number): string {
  return `$${pesos.toLocaleString("es-CO")}`;
}

/** 999999 es el "sin límite" de los planes grandes; no tiene sentido enseñarlo. */
function formatearLimite(n: number, singular: string, plural: string): string {
  if (n >= 999) {
    // Mayúscula inicial para que case con el "Hasta …" de la otra rama; si no,
    // en la misma lista conviven "Hasta 500 clientes" y "clientes ilimitados".
    return `${plural.charAt(0).toUpperCase()}${plural.slice(1)} ilimitados`;
  }
  return `Hasta ${n.toLocaleString("es-CO")} ${n === 1 ? singular : plural}`;
}

function PlanesPage() {
  const { plans } = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2 font-bold">
          <Stamp className="h-6 w-6 text-primary" />
          Fideliza
        </Link>
        <Link to="/comercio">
          <Button size="sm" variant="outline">
            Ya tengo cuenta
          </Button>
        </Link>
      </header>

      <section className="mx-auto max-w-5xl px-6 pb-16 pt-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Inicio
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight md:text-4xl">
          Elige el plan de tu negocio
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Tus clientes llevan la tarjeta en Google y Apple Wallet, reciben notificaciones al
          sumar sellos y vuelven. Sin desarrollar una app y sin cartones que se pierden.
        </p>

        {plans.length === 0 ? (
          <div className="mt-10 rounded-xl border bg-card p-6 text-center">
            <p className="font-medium">Estamos ajustando los planes</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Escríbenos y te contamos las opciones disponibles para tu negocio.
            </p>
          </div>
        ) : (
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {plans.map((plan: Plan, i: number) => {
              // El más caro se marca como recomendado. Los planes vienen
              // ordenados por precio ascendente desde el servidor.
              const destacado = i === plans.length - 1 && plans.length > 1;
              return (
                <div
                  key={plan.id}
                  className={`relative flex flex-col rounded-xl border bg-card p-6 ${
                    destacado ? "border-primary shadow-sm" : ""
                  }`}
                >
                  {destacado ? (
                    <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                      Más completo
                    </span>
                  ) : null}

                  <h2 className="text-lg font-bold">{plan.name}</h2>
                  {plan.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
                  ) : null}

                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-3xl font-bold">{formatearCOP(plan.price_cop)}</span>
                    <span className="text-sm text-muted-foreground">COP / mes</span>
                  </div>

                  <ul className="mt-5 grid gap-2 text-sm">
                    <li className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {formatearLimite(plan.max_members, "cliente", "clientes")}
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {formatearLimite(plan.max_programs, "programa", "programas")}
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      Tarjeta en Google Wallet y Apple Wallet
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      Notificaciones push al sumar sellos
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      Inscripción de clientes por QR
                    </li>
                  </ul>

                  <div className="mt-6 pt-2">
                    {/* El plan viaja en la URL hasta el alta del comercio. El
                        servidor lo vuelve a comprobar contra la BD: esto es
                        comodidad para el usuario, no una decisión de confianza. */}
                    <Link to="/comercio" search={{ plan: plan.id, nuevo: true }}>
                      <Button className="w-full gap-2" variant={destacado ? "default" : "outline"}>
                        Empezar con {plan.name} <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-sm text-muted-foreground">
          ¿Dudas sobre cuál te encaja? Empieza con el plan más sencillo: puedes cambiarlo
          después sin perder tus clientes ni sus sellos.
        </p>
      </section>
    </div>
  );
}

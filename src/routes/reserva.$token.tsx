import { createFileRoute, notFound } from "@tanstack/react-router";
import { Stamp, CalendarCheck, CalendarX, BedDouble, Users, Wallet } from "lucide-react";

import { getReservationByTokenFn } from "@/lib/loyaltyActions";

export const Route = createFileRoute("/reserva/$token")({
  // Página PÚBLICA: la abre el huésped desde el enlace que le manda el hotel,
  // sin cuenta ni contraseña. Lo que la protege es que el token es aleatorio.
  loader: async ({ params }) => {
    try {
      return await getReservationByTokenFn({ data: { token: params.token } });
    } catch {
      throw notFound();
    }
  },
  component: ReservaPage,
});

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function ReservaPage() {
  const r = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-8">
      <div className="mx-auto w-full max-w-sm">
        {/* La tarjeta, con el color del hotel: es lo primero que ve el huésped
            y lo que le confirma que el enlace es de verdad del hotel. */}
        <div
          className="rounded-2xl p-6 text-white shadow-lg"
          style={{ backgroundColor: r.brandColor || "#0f766e" }}
        >
          <div className="flex items-center gap-3">
            {r.logoUrl ? (
              <img
                src={r.logoUrl}
                alt={`Logo de ${r.hotelName}`}
                className="h-12 w-12 rounded-full bg-white/90 object-contain p-1"
              />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-full bg-white/20">
                <Stamp className="h-6 w-6" />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-lg font-bold leading-tight">{r.hotelName}</p>
              <p className="text-xs opacity-80">Reserva {r.reservation.code}</p>
            </div>
          </div>

          <p className="mt-5 text-2xl font-bold">{r.guestName}</p>

          <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide opacity-75">
                <CalendarCheck className="h-3.5 w-3.5" /> Llegada
              </p>
              <p className="mt-0.5 font-medium capitalize">{fechaLarga(r.reservation.checkIn)}</p>
            </div>
            <div>
              <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide opacity-75">
                <CalendarX className="h-3.5 w-3.5" /> Salida
              </p>
              <p className="mt-0.5 font-medium capitalize">{fechaLarga(r.reservation.checkOut)}</p>
            </div>
            {r.reservation.room ? (
              <div>
                <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide opacity-75">
                  <BedDouble className="h-3.5 w-3.5" /> Habitación
                </p>
                <p className="mt-0.5 font-medium">{r.reservation.room}</p>
              </div>
            ) : null}
            <div>
              <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide opacity-75">
                <Users className="h-3.5 w-3.5" /> Huéspedes
              </p>
              <p className="mt-0.5 font-medium">{r.reservation.guests}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border bg-card p-5 text-center">
          <p className="font-medium">Lleva tu reserva en el celular</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Guárdala en tu Wallet y tendrás a mano los datos de tu estancia, los servicios del
            hotel y el contacto de recepción.
          </p>

          {r.googleSaveUrl ? (
            // Botón propio en vez del distintivo oficial de Google: aquel se
            // sirve desde un dominio externo y, si no carga, el huésped ve una
            // imagen rota justo en el paso que importa. Esto siempre se pinta.
            <a
              href={r.googleSaveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 font-medium text-background transition hover:opacity-90"
            >
              <Wallet className="h-5 w-5" />
              Añadir a Google Wallet
            </a>
          ) : (
            <p className="mt-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              {r.googleMock
                ? "Google Wallet aún no está configurado en este entorno."
                : "No pudimos generar el pase. Avísale al hotel."}
            </p>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            La tarjeta caduca sola el día de tu salida.
          </p>
        </div>
      </div>
    </div>
  );
}

// Panel del hotel. Aquí el recepcionista crea la reserva y le manda al huésped
// el enlace con el que este se instala la tarjeta.
//
// Está separado de /comercio porque un hotel no da sellos: comparten la
// autenticación y el motor de pases, pero no la pantalla. /comercio redirige
// aquí cuando el negocio es de vertical 'hotel'.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  BedDouble,
  CalendarDays,
  Copy,
  LogOut,
  MessageCircle,
  Pencil,
  Plus,
  Trash2,
  Users,
  Link2,
  AlertTriangle,
  Settings,
  KeyRound,
  Award,
} from "lucide-react";

import { useSession, signOut, getAccessToken } from "@/lib/auth";
import { getBusinessSession } from "@/lib/businessSession";
import type { Business } from "@/lib/data";
import { updateBusinessCredentialsFn } from "@/lib/loyaltyActions";
import { LogoEditor } from "./comercio";
import type { Nivel } from "@/lib/hotelFidelizacion";
import {
  getHotelPanelFn,
  saveReservationFn,
  deleteReservationFn,
  saveHotelSettingsFn,
  type HotelReservation,
  type HotelSettings,
} from "@/lib/hotelActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/hotel")({
  component: HotelPanel,
});

// --- fechas ------------------------------------------------------------------

/** ISO -> valor de <input type="datetime-local"> en hora LOCAL del navegador. */
function aInputLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Valor del input -> ISO con zona.
 *
 * El input da hora local sin zona ("2026-10-02T15:00"). Mandarla tal cual haría
 * que el servidor, que corre en UTC, la leyera como UTC y la estancia se
 * desplazara cinco horas respecto a Colombia. new Date() la interpreta en la
 * zona del navegador —la del hotel— y toISOString la fija sin ambigüedad.
 */
function aISO(local: string): string {
  return new Date(local).toISOString();
}

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  confirmada: { texto: "Confirmada", clase: "bg-blue-100 text-blue-800 hover:bg-blue-100" },
  en_curso: { texto: "En curso", clase: "bg-green-100 text-green-800 hover:bg-green-100" },
  finalizada: { texto: "Finalizada", clase: "bg-muted text-muted-foreground hover:bg-muted" },
  cancelada: { texto: "Cancelada", clase: "bg-red-100 text-red-800 hover:bg-red-100" },
};

// --- pantalla ----------------------------------------------------------------

function HotelPanel() {
  const session = useSession();
  const navigate = useNavigate();
  const search = useSearch({ from: "/hotel" });
  const businessParam = (search as { business?: string }).business;

  const businessSession = useMemo(() => getBusinessSession(), []);
  const authed = Boolean(businessSession) || Boolean(session);
  const authPending = !businessSession && session === undefined;

  const [business, setBusiness] = useState<Business | null>(null);
  const [reservations, setReservations] = useState<HotelReservation[]>([]);
  const [settings, setSettings] = useState<HotelSettings | null>(null);
  const [settingsConfigured, setSettingsConfigured] = useState(true);
  const [loading, setLoading] = useState(true);

  const [editando, setEditando] = useState<HotelReservation | null>(null);
  const [creando, setCreando] = useState(false);
  const [borrando, setBorrando] = useState<HotelReservation | null>(null);
  const [credenciales, setCredenciales] = useState(false);

  useEffect(() => {
    if (businessSession) return;
    if (session === null) navigate({ to: "/login" });
  }, [session, businessSession, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await getHotelPanelFn({
        data: { token, businessId: businessSession ? undefined : businessParam },
      });
      setBusiness(res.business);
      setReservations(res.reservations);
      setSettings(res.settings);
      setSettingsConfigured(res.settingsConfigured);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [businessParam, businessSession]);

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  async function borrar() {
    if (!borrando) return;
    try {
      const token = await getAccessToken();
      await deleteReservationFn({
        data: {
          token,
          businessId: businessSession ? undefined : businessParam,
          reservationId: borrando.id,
        },
      });
      toast.success("Reserva borrada");
      setBorrando(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  }

  if (authPending || (authed && loading)) {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">Cargando…</div>
    );
  }
  if (!authed || !business) {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">
        Redirigiendo…
      </div>
    );
  }

  // Primero lo que está pasando y lo que viene; lo terminado, al final.
  const activas = reservations.filter((r) => r.status === "en_curso" || r.status === "confirmada");
  const pasadas = reservations.filter((r) => r.status === "finalizada" || r.status === "cancelada");

  return (
    <div className="min-h-screen bg-muted/30">
      <header
        className="px-4 py-5 text-white"
        style={{ backgroundColor: business.brand_color || "#0f766e" }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          {business.logo_url ? (
            <img
              src={business.logo_url}
              alt=""
              className="h-10 w-10 rounded-full bg-white/90 object-contain p-0.5"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold leading-tight">{business.name}</p>
            <p className="text-xs opacity-80">Panel de reservas</p>
          </div>
          {/* Solo el dueño: el hotel no se da credenciales a sí mismo. Vive aquí
              porque /comercio ya no es alcanzable para un negocio de hotel, y
              sin esto no habría forma de crearle el acceso a recepción. */}
          {!businessSession ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/20 hover:text-white"
              onClick={() => setCredenciales(true)}
              title="Acceso del hotel"
            >
              <KeyRound className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/20 hover:text-white"
            onClick={() => void signOut().then(() => navigate({ to: "/" }))}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        {!settingsConfigured ? (
          <div className="mb-5 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">La tarjeta sale sin los datos del hotel</p>
              <p className="mt-1">
                Sin configurar los contactos y servicios, el huésped recibe una tarjeta válida pero
                sin botón de recepción, sin WhatsApp y sin cómo llegar. Complétalo en “La tarjeta”.
              </p>
            </div>
          </div>
        ) : null}

        <Tabs defaultValue="reservas">
          <TabsList className="mb-4">
            <TabsTrigger value="reservas">Reservas</TabsTrigger>
            <TabsTrigger value="tarjeta">
              <Settings className="mr-1.5 h-3.5 w-3.5" />
              La tarjeta
            </TabsTrigger>
          </TabsList>

          <TabsContent value="reservas">
            <Button className="mb-4 w-full sm:w-auto" onClick={() => setCreando(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Nueva reserva
            </Button>

            {reservations.length === 0 ? (
              <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
                Todavía no hay reservas. Crea la primera y mándale el enlace al huésped.
              </div>
            ) : (
              <div className="space-y-3">
                {activas.map((r) => (
                  <TarjetaReserva
                    key={r.id}
                    r={r}
                    onEditar={() => setEditando(r)}
                    onBorrar={() => setBorrando(r)}
                  />
                ))}
                {pasadas.length > 0 ? (
                  <>
                    <p className="pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Estancias terminadas
                    </p>
                    {pasadas.map((r) => (
                      <TarjetaReserva
                        key={r.id}
                        r={r}
                        onEditar={() => setEditando(r)}
                        onBorrar={() => setBorrando(r)}
                      />
                    ))}
                  </>
                ) : null}
              </div>
            )}
          </TabsContent>

          <TabsContent value="tarjeta">
            <div className="space-y-5">
              {/* El mismo editor del panel de sellos. Se reutiliza en vez de
                  copiarlo: subir un logo tiene su truco (normalizar a PNG, que
                  es lo único que Apple admite) y no debe vivir en dos sitios. */}
              <LogoEditor business={business} reload={load} />
              {settings ? (
                <AjustesTarjeta
                  settings={settings}
                  businessId={businessSession ? undefined : businessParam}
                  onGuardado={load}
                />
              ) : null}
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {(creando || editando) && (
        <DialogoReserva
          reserva={editando}
          businessId={businessSession ? undefined : businessParam}
          onCerrar={() => {
            setCreando(false);
            setEditando(null);
          }}
          onGuardado={() => {
            setCreando(false);
            setEditando(null);
            void load();
          }}
        />
      )}

      {credenciales ? (
        <DialogoCredenciales business={business} onCerrar={() => setCredenciales(false)} />
      ) : null}

      <AlertDialog open={Boolean(borrando)} onOpenChange={(o) => !o && setBorrando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar esta reserva?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra la reserva de {borrando?.guestName} ({borrando?.reservationCode}). La ficha
              del huésped y su tarjeta se mantienen; el enlace de esta estancia deja de funcionar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void borrar()}>Borrar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --- una reserva -------------------------------------------------------------

function TarjetaReserva({
  r,
  onEditar,
  onBorrar,
}: {
  r: HotelReservation;
  onEditar: () => void;
  onBorrar: () => void;
}) {
  const estado = ESTADOS[r.status] ?? ESTADOS.confirmada;

  function copiarEnlace() {
    void navigator.clipboard.writeText(r.guestUrl);
    toast.success("Enlace copiado");
  }

  function enviarWhatsapp() {
    const texto = `Hola ${r.guestName}, aquí tienes tu tarjeta digital para tu estancia (reserva ${r.reservationCode}). Ábrela en el celular y guárdala en tu Wallet: ${r.guestUrl}`;
    const num = (r.phone ?? "").replace(/\D/g, "");
    // Sin teléfono se abre WhatsApp sin destinatario para que el recepcionista
    // elija el contacto, en vez de no hacer nada.
    const url = num
      ? `https://wa.me/${num.length > 10 ? num : `57${num}`}?text=${encodeURIComponent(texto)}`
      : `https://wa.me/?text=${encodeURIComponent(texto)}`;
    window.open(url, "_blank", "noopener");
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{r.guestName}</p>
          <p className="text-xs text-muted-foreground">
            Reserva {r.reservationCode}
            {r.documentId ? ` · CC ${r.documentId}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {r.nivel ? (
            <Badge variant="outline" className="gap-1">
              <Award className="h-3 w-3" />
              {r.nivel}
            </Badge>
          ) : null}
          <Badge className={estado.clase} variant="secondary">
            {estado.texto}
          </Badge>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5" />
          {fechaCorta(r.checkIn)} – {fechaCorta(r.checkOut)}
        </span>
        {r.room ? (
          <span className="flex items-center gap-1.5">
            <BedDouble className="h-3.5 w-3.5" />
            {r.room}
          </span>
        ) : null}
        <span className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          {r.guests}
        </span>
        <span className="flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5" />
          {r.passCreated ? "Tarjeta instalada" : "Sin instalar"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={enviarWhatsapp}>
          <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
          Enviar por WhatsApp
        </Button>
        <Button size="sm" variant="outline" onClick={copiarEnlace}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copiar enlace
        </Button>
        <Button size="sm" variant="ghost" onClick={onEditar}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onBorrar}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// --- crear / editar ----------------------------------------------------------

function DialogoReserva({
  reserva,
  businessId,
  onCerrar,
  onGuardado,
}: {
  reserva: HotelReservation | null;
  businessId?: string;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [guestName, setGuestName] = useState(reserva?.guestName ?? "");
  const [documentId, setDocumentId] = useState(reserva?.documentId ?? "");
  const [phone, setPhone] = useState(reserva?.phone ?? "");
  const [code, setCode] = useState(reserva?.reservationCode ?? "");
  const [room, setRoom] = useState(reserva?.room ?? "");
  const [guests, setGuests] = useState(reserva?.guests ?? 2);
  const [checkIn, setCheckIn] = useState(reserva ? aInputLocal(reserva.checkIn) : "");
  const [checkOut, setCheckOut] = useState(reserva ? aInputLocal(reserva.checkOut) : "");
  const [status, setStatus] = useState(reserva?.status ?? "confirmada");
  const [notes, setNotes] = useState(reserva?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const token = await getAccessToken();
      const res = await saveReservationFn({
        data: {
          token,
          businessId,
          reservationId: reserva?.id,
          guestName,
          documentId,
          phone: phone || undefined,
          reservationCode: code,
          room: room || undefined,
          guests,
          checkIn: aISO(checkIn),
          checkOut: aISO(checkOut),
          status: status as "confirmada" | "en_curso" | "finalizada" | "cancelada",
          notes: notes || undefined,
        },
      });
      toast.success(
        res.passUpdated
          ? "Reserva guardada. La tarjeta del huésped se actualizó."
          : "Reserva guardada",
      );
      onGuardado();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{reserva ? "Editar reserva" : "Nueva reserva"}</DialogTitle>
          <DialogDescription>
            Al guardar obtienes el enlace para mandarle la tarjeta al huésped.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="g-nombre">Nombre del huésped</Label>
            <Input
              id="g-nombre"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="g-cc">Cédula</Label>
              <Input
                id="g-cc"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="g-tel">Celular</Label>
              <Input
                id="g-tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="300 1234567"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Con la cédula reconocemos al huésped que vuelve: en vez de darle una tarjeta nueva, se
            actualiza la que ya tiene.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="g-cod">Código de reserva</Label>
              <Input id="g-cod" value={code} onChange={(e) => setCode(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="g-hab">Habitación</Label>
              <Input
                id="g-hab"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="Cabaña 7"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="g-in">Llegada</Label>
              <Input
                id="g-in"
                type="datetime-local"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="g-out">Salida</Label>
              <Input
                id="g-out"
                type="datetime-local"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                required
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            La tarjeta caduca sola en la fecha de salida.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="g-pax">Huéspedes</Label>
              <Input
                id="g-pax"
                type="number"
                min={1}
                max={50}
                value={guests}
                onChange={(e) => setGuests(Number(e.target.value))}
                required
              />
            </div>
            <div>
              <Label htmlFor="g-estado">Estado</Label>
              <select
                id="g-estado"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
              >
                <option value="confirmada">Confirmada</option>
                <option value="en_curso">En curso</option>
                <option value="finalizada">Finalizada</option>
                <option value="cancelada">Cancelada</option>
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="g-notas">Notas internas</Label>
            <Textarea
              id="g-notas"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="No sale en la tarjeta del huésped."
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- acceso del hotel --------------------------------------------------------

function DialogoCredenciales({ business, onCerrar }: { business: Business; onCerrar: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const url = `${window.location.origin}/p/${business.slug}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const token = await getAccessToken();
      await updateBusinessCredentialsFn({
        data: { token, businessId: business.id, username, password },
      });
      toast.success("Acceso configurado");
      onCerrar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Acceso del hotel</DialogTitle>
          <DialogDescription>
            Con esto recepción entra a este panel sin tener tu cuenta.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="c-url">Dirección de entrada</Label>
            <div className="flex gap-2">
              <Input id="c-url" value={url} readOnly className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  void navigator.clipboard.writeText(url);
                  toast.success("Copiada");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="c-user">Usuario</Label>
            <Input
              id="c-user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="c-pass">Contraseña</Label>
            <Input
              id="c-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Se guarda cifrada; no vuelve a mostrarse. Si la pierden, pon una nueva aquí.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- ajustes de la tarjeta ---------------------------------------------------

function AjustesTarjeta({
  settings,
  businessId,
  onGuardado,
}: {
  settings: HotelSettings;
  businessId?: string;
  onGuardado: () => void;
}) {
  const [receptionPhone, setReceptionPhone] = useState(settings.receptionPhone ?? "");
  const [whatsapp, setWhatsapp] = useState(settings.whatsapp ?? "");
  const [website, setWebsite] = useState(settings.website ?? "");
  const [services, setServices] = useState(settings.services);
  const [guide, setGuide] = useState(settings.guestGuide);
  const [niveles, setNiveles] = useState(settings.loyaltyLevels);
  const [saving, setSaving] = useState(false);

  async function guardar() {
    setSaving(true);
    try {
      const token = await getAccessToken();
      // Se descartan las filas a medio escribir en vez de rechazar el formulario:
      // una fila vacía al final es lo normal tras pulsar "añadir".
      const res = await saveHotelSettingsFn({
        data: {
          token,
          businessId,
          receptionPhone: receptionPhone || undefined,
          whatsapp: whatsapp || undefined,
          website: website || undefined,
          services: services.filter((s) => s.titulo.trim() && s.url.trim()),
          guestGuide: guide.filter((g) => g.titulo.trim() && g.valor.trim()),
          loyaltyLevels: niveles.filter((n) => n.nombre.trim() && n.beneficio.trim()),
        },
      });
      setWhatsapp(res.whatsapp ?? "");
      toast.success("Guardado. Las tarjetas ya instaladas se actualizan al editar su reserva.");
      onGuardado();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border bg-card p-4">
        <p className="font-medium">Contactos</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Salen como botones en la tarjeta del huésped.
        </p>
        <div className="mt-3 space-y-3">
          <div>
            <Label htmlFor="a-tel">Teléfono de recepción</Label>
            <Input
              id="a-tel"
              value={receptionPhone}
              onChange={(e) => setReceptionPhone(e.target.value)}
              placeholder="+57 322 7906642"
            />
          </div>
          <div>
            <Label htmlFor="a-wa">WhatsApp</Label>
            <Input
              id="a-wa"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+57 310 6673877"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Si lo escribes sin indicativo le ponemos +57: sin él, el botón no encuentra el número.
            </p>
          </div>
          <div>
            <Label htmlFor="a-web">Sitio web</Label>
            <Input
              id="a-web"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://…"
            />
          </div>
        </div>
      </div>

      <ListaEditable
        titulo="Servicios"
        ayuda="Botones extra: restaurante, spa, tours… Máximo 6."
        filas={services}
        campos={["titulo", "url"]}
        etiquetas={["Nombre", "Enlace"]}
        onChange={setServices}
        nuevaFila={() => ({ titulo: "", url: "" })}
      />

      <ListaEditable
        titulo="Guía del huésped"
        ayuda="Datos que el huésped consulta: wifi, horarios, normas. Máximo 6."
        filas={guide}
        campos={["titulo", "valor"]}
        etiquetas={["Título", "Texto"]}
        onChange={setGuide}
        nuevaFila={() => ({ titulo: "", valor: "" })}
      />

      <Niveles niveles={niveles} onChange={setNiveles} />

      <Button onClick={() => void guardar()} disabled={saving} className="w-full sm:w-auto">
        {saving ? "Guardando…" : "Guardar la tarjeta"}
      </Button>
    </div>
  );
}

/**
 * Niveles de fidelización.
 *
 * No reutiliza ListaEditable porque aquí una de las tres columnas es un número
 * y porque sin niguno la fidelización está APAGADA — y eso hay que decirlo, no
 * dejar una lista vacía que parezca un hueco por rellenar.
 */
function Niveles({ niveles, onChange }: { niveles: Nivel[]; onChange: (n: Nivel[]) => void }) {
  function editar(i: number, campo: keyof Nivel, valor: string | number) {
    const copia = [...niveles];
    copia[i] = { ...copia[i], [campo]: valor };
    onChange(copia);
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="flex items-center gap-2 font-medium">
        <Award className="h-4 w-4 text-primary" />
        Fidelización
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Cuando el huésped se va, su tarjeta deja de caducar y pasa a mostrar su nivel. Al reservar
        otra vez vuelve a mostrar la estancia. Sin niveles, la tarjeta caduca al salir, como antes.
      </p>

      {niveles.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="hidden gap-2 text-xs text-muted-foreground sm:flex">
            <span className="flex-1">Nivel</span>
            <span className="w-24">Estancias</span>
            <span className="flex-1">Qué le da</span>
            <span className="w-9" />
          </div>
          {niveles.map((n, i) => (
            <div key={i} className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={n.nombre}
                placeholder="Plata"
                onChange={(e) => editar(i, "nombre", e.target.value)}
                className="flex-1"
              />
              <Input
                type="number"
                min={1}
                value={n.estancias}
                onChange={(e) => editar(i, "estancias", Number(e.target.value))}
                className="sm:w-24"
              />
              <Input
                value={n.beneficio}
                placeholder="10% en el restaurante"
                onChange={(e) => editar(i, "beneficio", e.target.value)}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onChange(niveles.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">
          Fidelización apagada.
        </p>
      )}

      {niveles.length < 5 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() =>
            onChange([
              ...niveles,
              // Se propone el siguiente escalón en vez de dejarlo en blanco: un
              // nivel nuevo con el mismo mínimo que el anterior nunca se alcanza.
              {
                nombre: "",
                estancias: (niveles.at(-1)?.estancias ?? 0) + 2,
                beneficio: "",
              },
            ])
          }
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {niveles.length === 0 ? "Activar fidelización" : "Añadir nivel"}
        </Button>
      ) : null}
    </div>
  );
}

/** Lista de pares (título/valor) con añadir y quitar. La usan servicios y guía. */
function ListaEditable<T extends Record<string, string>>({
  titulo,
  ayuda,
  filas,
  campos,
  etiquetas,
  onChange,
  nuevaFila,
}: {
  titulo: string;
  ayuda: string;
  filas: T[];
  campos: [string, string];
  etiquetas: [string, string];
  onChange: (f: T[]) => void;
  nuevaFila: () => T;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="font-medium">{titulo}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{ayuda}</p>

      <div className="mt-3 space-y-2">
        {filas.map((f, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={f[campos[0]] ?? ""}
              placeholder={etiquetas[0]}
              onChange={(e) => {
                const copia = [...filas];
                copia[i] = { ...copia[i], [campos[0]]: e.target.value };
                onChange(copia);
              }}
            />
            <Input
              value={f[campos[1]] ?? ""}
              placeholder={etiquetas[1]}
              onChange={(e) => {
                const copia = [...filas];
                copia[i] = { ...copia[i], [campos[1]]: e.target.value };
                onChange(copia);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onChange(filas.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {filas.length < 6 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => onChange([...filas, nuevaFila()])}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Añadir
        </Button>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Llegaste al máximo que Wallet muestra.</p>
      )}
    </div>
  );
}

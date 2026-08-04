import { useEffect, useState, useCallback, useRef } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  Stamp,
  Plus,
  Gift,
  Copy,
  Store,
  ArrowLeft,
  LogOut,
  BellRing,
  Send,
  Megaphone,
  ImagePlus,
  ScanLine,
} from "lucide-react";

import { useSession, signOut, getAccessToken } from "@/lib/auth";
import type { Business, Member, Program } from "@/lib/data";
import {
  addStampFn,
  redeemRewardFn,
  sendMemberMessageFn,
  broadcastFn,
  createBusinessFn,
  updateStampMessageFn,
  getMyDashboardFn,
  uploadLogoFn,
} from "@/lib/loyaltyActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { LoyaltyCard } from "@/components/LoyaltyCard";

export const Route = createFileRoute("/comercio")({
  component: ComercioPanel,
});

function ComercioPanel() {
  const session = useSession();
  const navigate = useNavigate();
  const [business, setBusiness] = useState<Business | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const email = session?.user.email ?? "";

  // Sin sesión -> al login.
  useEffect(() => {
    if (session === null) navigate({ to: "/login" });
  }, [session, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await getMyDashboardFn({ data: { token } });
      setBusiness(res.business);
      setProgram(res.program);
      setMembers(res.members);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (session === undefined || (session && loading)) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Cargando…</div>;
  }
  if (!session) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Redirigiendo…</div>;
  }

  if (!business) {
    return <Onboarding email={email} onCreated={load} />;
  }

  return (
    <Dashboard
      business={business}
      program={program}
      members={members}
      email={email}
      reload={load}
    />
  );
}

// ---------------------------------------------------------------------------
// Onboarding: crear comercio + primer programa
// ---------------------------------------------------------------------------
export function Onboarding({ email, onCreated }: { email: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#7c3aed");
  const [programName, setProgramName] = useState("Tarjeta de sellos");
  const [required, setRequired] = useState(10);
  const [reward, setReward] = useState("Un producto gratis");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return toast.error("Escribe el nombre del negocio");
    setSaving(true);
    try {
      const token = await getAccessToken();
      await createBusinessFn({
        data: {
          token,
          name: name.trim(),
          brand_color: color,
          programName: programName.trim() || "Tarjeta de sellos",
          stamps_required: required,
          reward_description: reward.trim() || "Un producto gratis",
        },
      });
      toast.success("¡Negocio creado!");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="h-4 w-4" /> Inicio
          </Link>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{email}</span>
            <Button variant="ghost" size="sm" onClick={() => signOut()} className="gap-1">
              <LogOut className="h-4 w-4" /> Salir
            </Button>
          </div>
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Store className="h-6 w-6 text-primary" /> Crea tu tarjeta de fidelización
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configura tu negocio y tu programa de sellos en un minuto.
        </p>

        <form onSubmit={submit} className="mt-6 grid gap-4">
          <div className="grid gap-1.5">
            <Label>Nombre del negocio</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Panadería La Espiga" />
          </div>
          <div className="grid gap-1.5">
            <Label>Color de la tarjeta</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-16 rounded border"
              />
              <span className="text-sm text-muted-foreground">{color}</span>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Nombre del programa</Label>
            <Input value={programName} onChange={(e) => setProgramName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label>Sellos para el premio</Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={required}
                onChange={(e) => setRequired(Number(e.target.value))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Premio</Label>
              <Input value={reward} onChange={(e) => setReward(e.target.value)} />
            </div>
          </div>

          <div className="mt-2 flex justify-center">
            <LoyaltyCard
              businessName={name || "Tu negocio"}
              programName={programName || "Tarjeta de sellos"}
              rewardDescription={reward || "Un producto gratis"}
              stamps={3}
              stampsRequired={required || 10}
              brandColor={color}
            />
          </div>

          <Button type="submit" size="lg" disabled={saving}>
            {saving ? "Creando…" : "Crear negocio"}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard: gestión diaria
// ---------------------------------------------------------------------------
export function Dashboard({
  business,
  program,
  members,
  email,
  reload,
  onBack,
}: {
  business: Business;
  program: Program | null;
  members: Member[];
  email: string;
  reload: () => void;
  onBack?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msgMember, setMsgMember] = useState<Member | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const enrollUrl =
    typeof window !== "undefined" ? `${window.location.origin}/unirse/${business.slug}` : "";

  async function stamp(m: Member) {
    if (!program) return;
    setBusy(m.id);
    try {
      const token = await getAccessToken();
      const res = await addStampFn({ data: { token, memberId: m.id } });
      toast.success(
        res.completed ? "¡Tarjeta completa! 🎉" : "Sello agregado",
        { description: res.push.mock ? "Push simulado (configura Google Wallet para el real)" : "Notificación enviada al celular" },
      );
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  // Escanear el QR de un cliente para darle un sello (devuelve mensaje de estado).
  async function handleScan(memberId: string): Promise<{ ok: boolean; msg: string }> {
    try {
      const token = await getAccessToken();
      const res = await addStampFn({ data: { token, memberId } });
      reload();
      const msg = res.completed ? "¡Tarjeta completa! 🎉" : "Sello agregado ✅";
      toast.success(msg);
      return { ok: true, msg };
    } catch (err) {
      const m = err instanceof Error ? err.message : "Error";
      const friendly = /no eres due|No autorizado/i.test(m)
        ? "Esa tarjeta no es de tu negocio."
        : m;
      toast.error(friendly);
      return { ok: false, msg: friendly };
    }
  }

  async function redeem(m: Member) {
    setBusy(m.id);
    try {
      const token = await getAccessToken();
      await redeemRewardFn({ data: { token, memberId: m.id } });
      toast.success("Premio canjeado ✅");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="grid h-10 w-10 place-items-center rounded-full text-lg font-bold text-white"
              style={{ backgroundColor: business.brand_color }}
            >
              {business.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-xl font-bold">{business.name}</h1>
              <p className="text-xs text-muted-foreground">
                {program ? `${program.name} · ${program.stamps_required} sellos = ${program.reward_description}` : "Sin programa"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onBack ? (
              <Button variant="outline" size="sm" onClick={onBack} className="gap-1">
                <ArrowLeft className="h-4 w-4" /> Volver al admin
              </Button>
            ) : (
              <>
                <span className="hidden text-xs text-muted-foreground sm:inline">{email}</span>
                <Button variant="outline" size="sm" onClick={() => signOut()} className="gap-2">
                  <LogOut className="h-4 w-4" /> Salir
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_320px]">
          {/* Miembros */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Clientes ({members.length})</h2>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="gap-1"
                  disabled={!program}
                  onClick={() => setScanOpen(true)}
                >
                  <ScanLine className="h-4 w-4" />
                  <span className="hidden sm:inline">Escanear QR</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={!program || members.length === 0}
                  onClick={() => setBroadcastOpen(true)}
                >
                  <Megaphone className="h-4 w-4" />
                  <span className="hidden sm:inline">Aviso a todos</span>
                </Button>
              </div>
            </div>
            {members.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Aún no hay clientes. Comparte el QR de inscripción para que se registren.
              </div>
            ) : (
              <ul className="mt-3 divide-y rounded-xl border">
                {members.map((m) => {
                  const done = program ? m.stamps >= program.stamps_required : false;
                  return (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{m.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.stamps}/{program?.stamps_required ?? "?"} sellos · {m.rewards_redeemed} premios
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Enviar mensaje"
                          onClick={() => setMsgMember(m)}
                          className="gap-1"
                        >
                          <Send className="h-4 w-4" />
                          <span className="hidden sm:inline">Mensaje</span>
                        </Button>
                        {done ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy === m.id}
                            onClick={() => redeem(m)}
                            className="gap-1"
                          >
                            <Gift className="h-4 w-4" /> Canjear
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={busy === m.id}
                            onClick={() => stamp(m)}
                            className="gap-1"
                          >
                            <Plus className="h-4 w-4" /> Sello
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Inscripción */}
          <aside className="space-y-4">
            <div className="rounded-xl border bg-card p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Stamp className="h-4 w-4 text-primary" /> Inscribe clientes
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Que escaneen este QR o abran el enlace para agregar la tarjeta a Google Wallet.
              </p>
              {enrollUrl ? (
                <div className="mt-3 grid place-items-center rounded-lg bg-white p-3">
                  <QRCodeSVG value={enrollUrl} size={160} />
                </div>
              ) : null}
              <div className="mt-3 flex gap-2">
                <Input readOnly value={enrollUrl} className="text-xs" />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(enrollUrl);
                    toast.success("Enlace copiado");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Link to="/unirse/$slug" params={{ slug: business.slug }} target="_blank">
                <Button variant="link" size="sm" className="mt-1 px-0">
                  Abrir página de inscripción →
                </Button>
              </Link>
            </div>

            <LogoEditor business={business} reload={reload} />

            {program ? <StampMessageEditor program={program} reload={reload} /> : null}
          </aside>
        </div>
      </div>

      <MemberMessageDialog member={msgMember} onClose={() => setMsgMember(null)} />
      {program ? (
        <BroadcastDialog
          program={program}
          memberCount={members.length}
          open={broadcastOpen}
          onClose={() => setBroadcastOpen(false)}
        />
      ) : null}
      <ScanDialog open={scanOpen} onClose={() => setScanOpen(false)} onDetect={handleScan} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Escanear el QR de la tarjeta del cliente (cámara) para dar un sello
// ---------------------------------------------------------------------------
function ScanDialog({
  open,
  onClose,
  onDetect,
}: {
  open: boolean;
  onClose: () => void;
  onDetect: (memberId: string) => Promise<{ ok: boolean; msg: string }>;
}) {
  const [status, setStatus] = useState("Iniciando cámara…");
  const detectRef = useRef(onDetect);
  detectRef.current = onDetect;
  const busyRef = useRef(false);
  const lastRef = useRef<{ id: string; t: number }>({ id: "", t: 0 });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let scanner: any = null;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    async function onScan(text: string) {
      const now = Date.now();
      if (!UUID.test(text.trim())) {
        setStatus("Ese QR no es una tarjeta válida.");
        return;
      }
      const id = text.trim();
      if (busyRef.current) return;
      if (lastRef.current.id === id && now - lastRef.current.t < 4000) return;
      lastRef.current = { id, t: now };
      busyRef.current = true;
      setStatus("Procesando…");
      const res = await detectRef.current(id);
      setStatus(res.msg + " — puedes escanear el siguiente.");
      setTimeout(() => {
        busyRef.current = false;
      }, 1500);
    }

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        scanner = new Html5Qrcode("qr-reader-region", { verbose: false } as never);
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 240 },
          onScan,
          () => {},
        );
        if (!cancelled) setStatus("Apunta al QR de la tarjeta del cliente.");
      } catch {
        setStatus("No se pudo abrir la cámara. Revisa los permisos del navegador.");
      }
    })();

    return () => {
      cancelled = true;
      if (scanner) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {});
      }
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" /> Escanear QR del cliente
          </DialogTitle>
          <DialogDescription>
            Suma un sello escaneando el código QR de la tarjeta de Google Wallet del cliente.
          </DialogDescription>
        </DialogHeader>
        <div
          id="qr-reader-region"
          className="mx-auto w-full max-w-xs overflow-hidden rounded-lg border"
        />
        <p className="text-center text-sm text-muted-foreground">{status}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Enviar un aviso a TODOS los clientes (promoción / aviso importante)
// ---------------------------------------------------------------------------
function BroadcastDialog({
  program,
  memberCount,
  open,
  onClose,
}: {
  program: Program;
  memberCount: number;
  open: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setBody("");
    }
  }, [open]);

  async function send() {
    if (title.trim().length < 1 || body.trim().length < 1) {
      return toast.error("Escribe un título y un mensaje.");
    }
    setSending(true);
    try {
      const token = await getAccessToken();
      const res = await broadcastFn({
        data: { token, programId: program.id, title: title.trim(), body: body.trim() },
      });
      toast.success("Aviso enviado", {
        description: res.mock
          ? "Push simulado (configura Google Wallet para el real)"
          : `Enviado a ${res.sent} de ${res.total} clientes${res.failed ? ` (${res.failed} fallaron)` : ""}`,
      });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" /> Aviso a todos los clientes
          </DialogTitle>
          <DialogDescription>
            Se enviará a los <strong>{memberCount}</strong> clientes con la tarjeta, con
            notificación. Puedes usar <span className="font-mono">{"{negocio}"}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
          ⚠️ Google permite <strong>máximo 3 avisos con notificación cada 24 h</strong> por
          tarjeta. Úsalo solo para promos o avisos importantes.
        </div>

        <div className="grid gap-1.5">
          <Label>Título</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="¡Promo de fin de semana! 🎉"
            maxLength={60}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Mensaje</Label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="2x1 en todos los productos este sábado en {negocio}. ¡Te esperamos!"
            maxLength={300}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={send} disabled={sending} className="gap-1">
            <Megaphone className="h-4 w-4" /> {sending ? "Enviando…" : `Enviar a ${memberCount}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Enviar un mensaje personalizado a un cliente (cumpleaños, promo…)
// ---------------------------------------------------------------------------
const MESSAGE_PRESETS: { label: string; title: string; body: string }[] = [
  {
    label: "🎂 Cumpleaños",
    title: "¡Feliz cumpleaños, {nombre}! 🎂",
    body: "En {negocio} queremos celebrarte. Pásate y reclama una sorpresa especial. 🎁",
  },
  {
    label: "💜 Te extrañamos",
    title: "¡Te extrañamos, {nombre}!",
    body: "Hace rato no te vemos por {negocio}. Vuelve pronto y sigue sumando sellos.",
  },
  {
    label: "🎉 Promo",
    title: "Promo especial para ti 🎉",
    body: "{nombre}, hoy tenemos algo especial en {negocio}. ¡Te esperamos!",
  },
];

function MemberMessageDialog({
  member,
  onClose,
}: {
  member: Member | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  // Reinicia los campos cada vez que se abre para un cliente distinto.
  useEffect(() => {
    if (member) {
      setTitle("");
      setBody("");
    }
  }, [member]);

  async function send() {
    if (!member) return;
    if (title.trim().length < 1 || body.trim().length < 1) {
      return toast.error("Escribe un título y un mensaje.");
    }
    setSending(true);
    try {
      const token = await getAccessToken();
      const res = await sendMemberMessageFn({
        data: { token, memberId: member.id, title: title.trim(), body: body.trim() },
      });
      toast.success("Mensaje enviado", {
        description: res.push.mock
          ? "Push simulado (configura Google Wallet para el real)"
          : "Le llegó a la tarjeta del cliente",
      });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar mensaje a {member?.full_name}</DialogTitle>
          <DialogDescription>
            Le llega a su tarjeta en Google Wallet con notificación. Puedes usar{" "}
            <span className="font-mono">{"{nombre}"}</span> y{" "}
            <span className="font-mono">{"{negocio}"}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1">
          {MESSAGE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setTitle(p.title);
                setBody(p.body);
              }}
              className="rounded-full border px-2.5 py-1 text-xs hover:bg-accent"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid gap-1.5">
          <Label>Título</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="¡Feliz cumpleaños! 🎂"
            maxLength={60}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Mensaje</Label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="Escribe tu mensaje…"
            maxLength={300}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={send} disabled={sending} className="gap-1">
            <Send className="h-4 w-4" /> {sending ? "Enviando…" : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Subir/cambiar el logo del negocio
// ---------------------------------------------------------------------------
function LogoEditor({ business, reload }: { business: Business; reload: () => void }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("Usa una imagen PNG, JPG o WEBP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("La imagen supera 5MB.");
      return;
    }
    setUploading(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
      }
      const dataBase64 = btoa(bin);
      const token = await getAccessToken();
      await uploadLogoFn({
        data: {
          token,
          businessId: business.id,
          contentType: file.type as "image/png" | "image/jpeg" | "image/webp",
          dataBase64,
        },
      });
      toast.success("Logo actualizado", { description: "Ya aparece en la tarjeta de Wallet." });
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <ImagePlus className="h-4 w-4 text-primary" /> Logo del negocio
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Aparece en la tarjeta de Google Wallet. Cuadrado, mín. 640×640 px, máx. 5MB.
      </p>
      <div className="mt-3 flex items-center gap-3">
        {business.logo_url ? (
          <img
            src={business.logo_url}
            alt="Logo"
            className="h-14 w-14 rounded-lg border object-cover"
          />
        ) : (
          <div
            className="grid h-14 w-14 place-items-center rounded-lg border text-lg font-bold text-white"
            style={{ backgroundColor: business.brand_color }}
          >
            {business.name.charAt(0)}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onFile}
          className="hidden"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Subiendo…" : business.logo_url ? "Cambiar logo" : "Subir logo"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor del mensaje push que recibe el cliente al recibir un sello
// ---------------------------------------------------------------------------
function StampMessageEditor({ program, reload }: { program: Program; reload: () => void }) {
  const [text, setText] = useState(program.stamp_message ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const token = await getAccessToken();
      await updateStampMessageFn({
        data: { token, programId: program.id, stamp_message: text.trim() || null },
      });
      toast.success("Mensaje guardado");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <BellRing className="h-4 w-4 text-primary" /> Mensaje al dar un sello
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Escribe la notificación push que recibirá tu cliente al darle un sello.
        Si lo dejas vacío, se usa un mensaje por defecto.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="mt-2 text-sm"
        placeholder="Ej.: ¡Gracias por tu visita! Un sello más para tu premio 🎁"
      />
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setText("")}
          disabled={saving || text.length === 0}
        >
          Limpiar
        </Button>
        <Button size="sm" onClick={save} disabled={saving} className="flex-1">
          {saving ? "Guardando…" : "Guardar mensaje"}
        </Button>
      </div>
    </div>
  );
}

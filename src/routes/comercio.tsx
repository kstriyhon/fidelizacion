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
  MapPin,
  MessageCircle,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";

import { useSession, signOut, getAccessToken } from "@/lib/auth";
import { computeMetrics, isInactiveMember, isNewMember } from "@/lib/metrics";
import type { Business, Member, Program } from "@/lib/data";
import {
  addStampFn,
  redeemRewardFn,
  sendMemberMessageFn,
  updateMemberFn,
  deleteMemberFn,
  broadcastFn,
  createBusinessFn,
  updateProgramFn,
  updateStampMessageFn,
  updateWelcomeMessageFn,
  getMyDashboardFn,
  uploadLogoFn,
  setBusinessLocationFn,
  createProgramFn,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoyaltyCard } from "@/components/LoyaltyCard";

export const Route = createFileRoute("/comercio")({
  component: ComercioPanel,
});

function ComercioPanel() {
  const session = useSession();
  const navigate = useNavigate();
  const [business, setBusiness] = useState<Business | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
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
      setPrograms(res.programs);
      setMembers(res.members);
      if (res.programs.length > 0) {
        setSelectedProgramId(res.programs[0].id);
      }
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
      programs={programs}
      selectedProgramId={selectedProgramId}
      onSelectProgram={setSelectedProgramId}
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
  programs,
  selectedProgramId,
  onSelectProgram,
  members,
  email,
  reload,
  onBack,
}: {
  business: Business;
  programs: Program[];
  selectedProgramId: string | null;
  onSelectProgram: (programId: string) => void;
  members: Member[];
  email: string;
  reload: () => void;
  onBack?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msgMember, setMsgMember] = useState<Member | null>(null);
  const [editMember, setEditMember] = useState<Member | null>(null);
  const [delMember, setDelMember] = useState<Member | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [programEditOpen, setProgramEditOpen] = useState(false);
  const [newProgramOpen, setNewProgramOpen] = useState(false);
  const [inactiveDays, setInactiveDays] = useState(30);
  const [memberFilter, setMemberFilter] = useState<"all" | "new" | "inactive">("all");
  const [search, setSearch] = useState("");

  const selectedProgram = programs.find((p) => p.id === selectedProgramId) ?? programs[0] ?? null;
  const required = selectedProgram?.stamps_required ?? 1;

  const programMembers = selectedProgram ? members.filter((m) => m.program_id === selectedProgram.id) : [];
  const metrics = computeMetrics(programMembers, () => required, { inactiveDays });

  const q = search.trim().toLowerCase();
  const shownMembers = programMembers.filter((m) => {
    if (memberFilter === "new" && !isNewMember(m)) return false;
    if (memberFilter === "inactive" && !isInactiveMember(m, inactiveDays)) return false;
    if (q && !`${m.full_name} ${m.phone ?? ""} ${m.email ?? ""}`.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

  const enrollUrl =
    typeof window !== "undefined" && selectedProgram
      ? `${window.location.origin}/unirse/${business.slug}?program=${selectedProgram.id}`
      : "";

  async function stamp(m: Member) {
    if (!selectedProgram) return;
    setBusy(m.id);
    try {
      const token = await getAccessToken();
      const res = await addStampFn({ data: { token, memberId: m.id } });
      toast.success(
        res.completed ? "¡Tarjeta completa! 🎉" : "Sello agregado",
        { description: res.push.mock ? "Push simulado (configura Google y Apple Wallet para el real)" : "Notificación enviada al celular" },
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
              {programs.length > 1 ? (
                <div className="mt-2 flex gap-2">
                  {programs.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onSelectProgram(p.id)}
                      className={`px-3 py-1 text-xs rounded-full font-medium transition ${
                        selectedProgramId === p.id
                          ? "bg-primary text-white"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground mt-1">
                {selectedProgram ? `${selectedProgram.name} · ${selectedProgram.stamps_required} sellos = ${selectedProgram.reward_description}` : "Sin programa"}
              </p>
              {selectedProgram ? (
                <div className="mt-2 flex gap-2">
                  {selectedProgram ? (
                    <button
                      type="button"
                      onClick={() => setProgramEditOpen(true)}
                      className="inline-flex items-center gap-1 rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/80 transition"
                    >
                      <Pencil className="h-4 w-4" />
                      Editar
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setNewProgramOpen(true)}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition"
                  >
                    <Plus className="h-4 w-4" />
                    Nuevo programa
                  </button>
                </div>
              ) : null}
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

        {business.status === "paused" ? (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            ⚠️ <strong>Servicio pausado.</strong> No puedes inscribir clientes ni dar sellos.
            Contacta al administrador para reactivarlo.
          </div>
        ) : null}

        {/* Métricas */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <MetricCard label="Clientes" value={metrics.total} />
          <MetricCard label="Nuevos (30d)" value={metrics.nuevos} />
          <MetricCard label="Sellos dados" value={metrics.sellosDados} />
          <MetricCard label="Premios" value={metrics.premios} />
          <MetricCard label="Inactivos" value={metrics.inactivos} warn={metrics.inactivos > 0} />
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
                  disabled={!selectedProgram}
                  onClick={() => setScanOpen(true)}
                >
                  <ScanLine className="h-4 w-4" />
                  <span className="hidden sm:inline">Escanear QR</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={!selectedProgram || programMembers.length === 0}
                  onClick={() => setBroadcastOpen(true)}
                >
                  <Megaphone className="h-4 w-4" />
                  <span className="hidden sm:inline">Aviso a todos</span>
                </Button>
              </div>
            </div>

            {/* Buscador + filtros */}
            {members.length > 0 ? (
              <div className="mt-3 space-y-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nombre, teléfono o email…"
                  className="h-8 text-sm"
                />
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      { k: "all", label: `Todos (${metrics.total})` },
                      { k: "new", label: `Nuevos (${metrics.nuevos})` },
                      { k: "inactive", label: `Inactivos (${metrics.inactivos})` },
                    ] as const
                  ).map((f) => (
                    <Button
                      key={f.k}
                      size="sm"
                      variant={memberFilter === f.k ? "default" : "outline"}
                      className="h-7"
                      onClick={() => setMemberFilter(f.k)}
                    >
                      {f.label}
                    </Button>
                  ))}
                  {memberFilter === "inactive" ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      sin volver en
                      <select
                        value={inactiveDays}
                        onChange={(e) => setInactiveDays(Number(e.target.value))}
                        className="h-7 rounded-md border border-input bg-transparent px-2"
                      >
                        <option value={15}>15 días</option>
                        <option value={30}>30 días</option>
                        <option value={60}>60 días</option>
                        <option value={90}>90 días</option>
                      </select>
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {members.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Aún no hay clientes. Comparte el QR de inscripción para que se registren.
              </div>
            ) : shownMembers.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                {memberFilter === "inactive"
                  ? "No hay clientes inactivos en esta ventana. 🎉"
                  : "Ningún cliente coincide con el filtro/búsqueda."}
              </div>
            ) : (
              <ul className="mt-3 divide-y rounded-xl border">
                {shownMembers.map((m) => {
                  const done = selectedProgram ? m.stamps >= selectedProgram.stamps_required : false;
                  const inactive = isInactiveMember(m, inactiveDays);
                  const nuevo = isNewMember(m);
                  return (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate font-medium">
                          {m.full_name}
                          {nuevo ? (
                            <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                              Nuevo
                            </span>
                          ) : null}
                          {inactive ? (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              Inactivo
                            </span>
                          ) : null}
                          {m.wallet_object_id ? (
                            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400" title="Google Wallet">
                              Google ✓
                            </span>
                          ) : null}
                          {m.apple_pass_serial_number ? (
                            <span className="rounded-full bg-gray-500/15 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-400" title="Apple Wallet">
                              Apple ✓
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {m.stamps}/{selectedProgram?.stamps_required ?? "?"} sellos · {m.rewards_redeemed} premios
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
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" title="Más opciones">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditMember(m)}>
                              <Pencil className="mr-2 h-4 w-4" /> Editar cliente
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDelMember(m)}
                              className="text-red-600 focus:text-red-700"
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Eliminar tarjeta
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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
                Que escaneen este QR o abran el enlace para agregar la tarjeta a Google Wallet o Apple Wallet.
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

            <LocationEditor business={business} reload={reload} />

            {selectedProgram ? <WelcomeMessageEditor program={selectedProgram} reload={reload} /> : null}

            {selectedProgram ? <StampMessageEditor program={selectedProgram} reload={reload} /> : null}
          </aside>
        </div>
      </div>

      <MemberMessageDialog
        member={msgMember}
        businessName={business.name}
        onClose={() => setMsgMember(null)}
      />
      {selectedProgram ? (
        <BroadcastDialog
          program={selectedProgram}
          memberCount={programMembers.length}
          open={broadcastOpen}
          onClose={() => setBroadcastOpen(false)}
        />
      ) : null}
      <ScanDialog open={scanOpen} onClose={() => setScanOpen(false)} onDetect={handleScan} />
      <MemberEditDialog member={editMember} onClose={() => setEditMember(null)} reload={reload} />
      <MemberDeleteDialog member={delMember} onClose={() => setDelMember(null)} reload={reload} />
      {selectedProgram ? (
        <ProgramEditDialog
          program={selectedProgram}
          open={programEditOpen}
          onClose={() => setProgramEditOpen(false)}
          reload={reload}
        />
      ) : null}
      <NewProgramDialog open={newProgramOpen} onClose={() => setNewProgramOpen(false)} reload={reload} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editar el programa de sellos (nombre, sellos requeridos, premio)
// ---------------------------------------------------------------------------
function ProgramEditDialog({
  program,
  open,
  onClose,
  reload,
}: {
  program: Program;
  open: boolean;
  onClose: () => void;
  reload: () => void;
}) {
  const [name, setName] = useState(program.name);
  const [required, setRequired] = useState(program.stamps_required);
  const [reward, setReward] = useState(program.reward_description);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(program.name);
      setRequired(program.stamps_required);
      setReward(program.reward_description);
    }
  }, [open, program]);

  async function save() {
    if (name.trim().length < 1 || reward.trim().length < 1) {
      return toast.error("Completa el nombre y el premio.");
    }
    setSaving(true);
    try {
      const token = await getAccessToken();
      await updateProgramFn({
        data: {
          token,
          programId: program.id,
          name: name.trim(),
          stamps_required: required,
          reward_description: reward.trim(),
        },
      });
      toast.success("Programa actualizado");
      onClose();
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar programa de sellos</DialogTitle>
          <DialogDescription>
            Cambia el nombre, cuántos sellos se necesitan y el premio. Se refleja en las tarjetas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Nombre del programa</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <div className="grid grid-cols-2 gap-3">
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
              <Input value={reward} onChange={(e) => setReward(e.target.value)} maxLength={120} />
            </div>
          </div>
          <p className="rounded-lg bg-muted/50 p-2 text-[11px] text-muted-foreground">
            Nota: si cambias los sellos requeridos, el contador de cada cliente se ajusta en su
            próximo sello. Los clientes con sellos suficientes podrán canjear.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Crear nuevo programa
// ---------------------------------------------------------------------------
function NewProgramDialog({
  open,
  onClose,
  reload,
}: {
  open: boolean;
  onClose: () => void;
  reload: () => void;
}) {
  const [name, setName] = useState("");
  const [required, setRequired] = useState(10);
  const [reward, setReward] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setRequired(10);
      setReward("");
    }
  }, [open]);

  async function save() {
    if (name.trim().length < 2) return toast.error("Escribe el nombre del programa");
    if (reward.trim().length < 2) return toast.error("Escribe la descripción del premio");
    setSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      await createProgramFn({
        data: {
          token,
          name: name.trim(),
          stamps_required: required,
          reward_description: reward.trim(),
        },
      });
      toast.success("¡Programa creado!");
      onClose();
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo programa de lealtad</DialogTitle>
          <DialogDescription>Crea un nuevo programa para tus clientes.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Nombre del programa</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Tarjeta Compras" />
          </div>
          <div className="grid grid-cols-2 gap-3">
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
              <Input value={reward} onChange={(e) => setReward(e.target.value)} placeholder="Ej: Descuento 20%" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Creando…" : "Crear programa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
            Suma un sello escaneando el código QR de la tarjeta de Google o Apple Wallet del cliente.
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
          ? "Push simulado (configura Google y Apple Wallet para el real)"
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
  businessName,
  onClose,
}: {
  member: Member | null;
  businessName: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  function openWhatsApp() {
    if (!member) return;
    const phone = (member.phone || "").replace(/\D/g, "");
    if (!phone) {
      toast.error("Este cliente no dejó número de WhatsApp.");
      return;
    }
    const fill = (s: string) =>
      s.replace(/\{nombre\}/g, member.full_name).replace(/\{negocio\}/g, businessName);
    const t = fill(title.trim());
    const b = fill(body.trim());
    const text = [t, b].filter(Boolean).join("\n\n") || fill(`¡Hola {nombre}!`);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
  }

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
          ? "Push simulado (configura Google y Apple Wallet para el real)"
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
            Envíalo a su tarjeta de Google o Apple Wallet (notificación) o por WhatsApp. Puedes usar{" "}
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

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={openWhatsApp}
            disabled={sending}
            className="gap-1 text-green-600 hover:text-green-700"
            title={member?.phone ? "Abrir WhatsApp con el mensaje" : "Este cliente no dejó WhatsApp"}
          >
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </Button>
          <div className="flex gap-2 sm:ml-auto">
            <Button variant="outline" onClick={onClose} disabled={sending}>
              Cancelar
            </Button>
            <Button onClick={send} disabled={sending} className="gap-1">
              <Send className="h-4 w-4" /> {sending ? "Enviando…" : "Enviar a Wallet"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Editar la información de un cliente
// ---------------------------------------------------------------------------
function MemberEditDialog({
  member,
  onClose,
  reload,
}: {
  member: Member | null;
  onClose: () => void;
  reload: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (member) {
      setName(member.full_name);
      setPhone(member.phone ?? "");
      setEmail(member.email ?? "");
    }
  }, [member]);

  if (!member) return null;

  async function save() {
    if (!member) return;
    if (name.trim().length < 2) return toast.error("Escribe el nombre del cliente.");
    setSaving(true);
    try {
      const token = await getAccessToken();
      await updateMemberFn({
        data: {
          token,
          memberId: member.id,
          full_name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
        },
      });
      toast.success("Cliente actualizado");
      onClose();
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar cliente</DialogTitle>
          <DialogDescription>Actualiza los datos de {member.full_name}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>WhatsApp</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+57…" />
            </div>
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@…" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Eliminar la tarjeta de un cliente
// ---------------------------------------------------------------------------
function MemberDeleteDialog({
  member,
  onClose,
  reload,
}: {
  member: Member | null;
  onClose: () => void;
  reload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!member) return null;

  async function del() {
    if (!member) return;
    setBusy(true);
    try {
      const token = await getAccessToken();
      await deleteMemberFn({ data: { token, memberId: member.id } });
      toast.success("Tarjeta eliminada");
      onClose();
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eliminar tarjeta</DialogTitle>
          <DialogDescription>
            Se eliminará a <strong>{member.full_name}</strong> y su historial de sellos. Su pase se
            marcará como expirado en Google y Apple Wallet. No se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            className="bg-red-600 text-white hover:bg-red-700"
            onClick={del}
            disabled={busy}
          >
            {busy ? "Eliminando…" : "Sí, eliminar"}
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
        Aparece en la tarjeta de Google y Apple Wallet. Cuadrado, mín. 640×640 px, máx. 5MB.
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
// Alertas de proximidad: ubicación del negocio
// ---------------------------------------------------------------------------
function LocationEditor({ business, reload }: { business: Business; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const hasLoc = business.latitude != null && business.longitude != null;

  async function save(latitude: number | null, longitude: number | null, okMsg: string) {
    setBusy(true);
    try {
      const token = await getAccessToken();
      await setBusinessLocationFn({ data: { token, businessId: business.id, latitude, longitude } });
      toast.success(okMsg);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  function useCurrent() {
    if (!navigator.geolocation) {
      toast.error("Tu navegador no soporta geolocalización.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => save(pos.coords.latitude, pos.coords.longitude, "Ubicación guardada"),
      () => {
        setBusy(false);
        toast.error("No se pudo obtener la ubicación. Acepta el permiso de ubicación.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <MapPin className="h-4 w-4 text-primary" /> Alertas de proximidad
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Cuando un cliente pase cerca de tu negocio, Google Wallet le mostrará su tarjeta. La
        distancia la decide Google (~150 m).
      </p>
      {hasLoc ? (
        <p className="mt-2 text-xs">
          📍 Ubicación configurada ({business.latitude!.toFixed(5)}, {business.longitude!.toFixed(5)})
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Sin ubicación configurada.</p>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" className="gap-1" disabled={busy} onClick={useCurrent}>
          <MapPin className="h-4 w-4" />
          {busy ? "Obteniendo…" : hasLoc ? "Actualizar ubicación" : "Usar mi ubicación actual"}
        </Button>
        {hasLoc ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => save(null, null, "Ubicación eliminada")}
          >
            Quitar
          </Button>
        ) : null}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        💡 Consejo: hazlo estando físicamente en el local para capturar la ubicación correcta.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor del mensaje de bienvenida (al inscribirse)
// ---------------------------------------------------------------------------
function MetricCard({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded-xl border bg-card p-3 ${warn ? "border-amber-500/40" : ""}`}>
      <p
        className={`text-xl font-bold leading-none ${warn ? "text-amber-600 dark:text-amber-400" : ""}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function WelcomeMessageEditor({ program, reload }: { program: Program; reload: () => void }) {
  const [text, setText] = useState(program.welcome_message ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const token = await getAccessToken();
      await updateWelcomeMessageFn({
        data: { token, programId: program.id, welcome_message: text.trim() || null },
      });
      toast.success("Mensaje de bienvenida guardado");
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
        <BellRing className="h-4 w-4 text-primary" /> Mensaje de bienvenida
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Aparece en la tarjeta del cliente al inscribirse. Puedes usar{" "}
        <span className="font-mono">{"{nombre}"}</span> y{" "}
        <span className="font-mono">{"{negocio}"}</span>. Vacío = mensaje por defecto.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="mt-2 text-sm"
        placeholder="Ej.: ¡Hola {nombre}! Gracias por unirte a {negocio}. 🎉"
      />
      <Button size="sm" onClick={save} disabled={saving} className="mt-2 w-full">
        {saving ? "Guardando…" : "Guardar bienvenida"}
      </Button>
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

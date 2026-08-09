import { useEffect, useState, useCallback } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ShieldCheck,
  ArrowLeft,
  LogOut,
  Store,
  Users,
  Stamp,
  Gift,
  Plus,
  Settings,
  Pencil,
  Pause,
  Play,
  Trash2,
  UserPlus,
  UserX,
} from "lucide-react";

import { useSession, signOut, getAccessToken } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admins";
import { isNewMember, isInactiveMember } from "@/lib/metrics";
import type { Business, Member, Program } from "@/lib/data";
import {
  adminListFn,
  adminGetBusinessFn,
  adminUpdateBusinessFn,
  adminSetBusinessStatusFn,
  adminDeleteBusinessFn,
} from "@/lib/loyaltyActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Dashboard, Onboarding } from "./comercio";

export const Route = createFileRoute("/admin")({
  component: AdminPanel,
});

type BusinessRow = Business & {
  programs: (Program & { members: Member[] })[];
};

function AdminPanel() {
  const session = useSession();
  const navigate = useNavigate();
  const [rows, setRows] = useState<BusinessRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<
    { t: "list" } | { t: "create" } | { t: "manage"; id: string }
  >({ t: "list" });
  const [adminBiz, setAdminBiz] = useState<Business | null>(null);

  const email = session?.user.email ?? "";
  const isAdmin = isAdminEmail(email);

  useEffect(() => {
    if (session === null) navigate({ to: "/login" });
  }, [session, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const { businesses, programs, members } = await adminListFn({ data: { token } });
      const result: BusinessRow[] = businesses.map((b) => ({
        ...b,
        programs: programs
          .filter((p) => p.business_id === b.id)
          .map((p) => ({ ...p, members: members.filter((m) => m.program_id === p.id) })),
      }));
      setRows(result);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin, load]);

  if (session === undefined) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Cargando…</div>;
  }
  if (!session) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Redirigiendo…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-3 text-lg font-bold">Acceso restringido</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu cuenta ({email}) no tiene permisos de administrador.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link to="/comercio">
              <Button variant="outline" size="sm">Ir a mi panel</Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => signOut()} className="gap-1">
              <LogOut className="h-4 w-4" /> Salir
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (view.t === "create") {
    return (
      <Onboarding
        email={email}
        onCreated={() => {
          setView({ t: "list" });
          load();
        }}
      />
    );
  }
  if (view.t === "manage") {
    return (
      <AdminManage
        businessId={view.id}
        email={email}
        onBack={() => {
          setView({ t: "list" });
          load();
        }}
      />
    );
  }

  const totalMembers = rows?.reduce(
    (n, b) => n + b.programs.reduce((m, p) => m + p.members.length, 0),
    0,
  );
  const totalStamps = rows?.reduce(
    (n, b) =>
      n + b.programs.reduce((m, p) => m + p.members.reduce((s, mem) => s + mem.stamps, 0), 0),
    0,
  );
  const totalRewards = rows?.reduce(
    (n, b) =>
      n +
      b.programs.reduce((m, p) => m + p.members.reduce((s, mem) => s + mem.rewards_redeemed, 0), 0),
    0,
  );
  const allMembers = (rows ?? []).flatMap((b) => b.programs.flatMap((p) => p.members));
  const totalNuevos = allMembers.filter((m) => isNewMember(m)).length;
  const totalInactivos = allMembers.filter((m) => isInactiveMember(m, 30)).length;

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <ArrowLeft className="h-4 w-4" /> Inicio
            </Link>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
              <ShieldCheck className="h-6 w-6 text-primary" /> Panel de administrador
            </h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{email}</span>
            <Button variant="outline" size="sm" onClick={() => signOut()} className="gap-1">
              <LogOut className="h-4 w-4" /> Salir
            </Button>
          </div>
        </div>

        {/* Resumen */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard icon={Store} label="Negocios" value={rows?.length ?? "—"} />
          <StatCard icon={Users} label="Clientes" value={totalMembers ?? "—"} />
          <StatCard icon={UserPlus} label="Nuevos (30d)" value={rows ? totalNuevos : "—"} />
          <StatCard icon={Stamp} label="Sellos activos" value={totalStamps ?? "—"} />
          <StatCard icon={Gift} label="Premios" value={totalRewards ?? "—"} />
          <StatCard icon={UserX} label="Inactivos (30d)" value={rows ? totalInactivos : "—"} />
        </div>

        <div className="mt-8 flex items-center justify-between">
          <h2 className="font-semibold">Negocios</h2>
          <Button size="sm" className="gap-1" onClick={() => setView({ t: "create" })}>
            <Plus className="h-4 w-4" /> Crear negocio
          </Button>
        </div>

        {loading ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">Cargando negocios…</p>
        ) : (
          <div className="mt-3 space-y-4">
            {(rows ?? []).map((b) => (
              <BusinessCard
                key={b.id}
                business={b}
                onManage={() => setView({ t: "manage", id: b.id })}
                onAdmin={() => setAdminBiz(b)}
              />
            ))}
            {rows && rows.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">No hay negocios todavía.</p>
            ) : null}
          </div>
        )}
      </div>

      <BusinessAdminDialog
        business={adminBiz}
        onClose={() => setAdminBiz(null)}
        reload={() => {
          setAdminBiz(null);
          load();
        }}
      />
    </div>
  );
}

// Administración empresarial de una empresa: editar datos, pausar/reactivar, eliminar.
function BusinessAdminDialog({
  business,
  onClose,
  reload,
}: {
  business: Business | null;
  onClose: () => void;
  reload: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [payment, setPayment] = useState<"up_to_date" | "overdue">("up_to_date");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (business) {
      setName(business.name);
      setPhone(business.contact_phone ?? "");
      setEmail(business.email ?? "");
      setPayment(business.payment_status);
      setConfirmDel(false);
    }
  }, [business]);

  if (!business) return null;
  const paused = business.status === "paused";

  async function save() {
    if (!business) return;
    setBusy(true);
    try {
      const token = await getAccessToken();
      await adminUpdateBusinessFn({
        data: {
          token,
          businessId: business.id,
          name: name.trim(),
          contact_phone: phone.trim() || null,
          email: email.trim() || null,
          payment_status: payment,
        },
      });
      toast.success("Datos actualizados");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function togglePause() {
    if (!business) return;
    setBusy(true);
    try {
      const token = await getAccessToken();
      const status = paused ? "active" : "paused";
      await adminSetBusinessStatusFn({ data: { token, businessId: business.id, status } });
      toast.success(status === "paused" ? "Servicio pausado" : "Servicio reactivado");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!business) return;
    setBusy(true);
    try {
      const token = await getAccessToken();
      await adminDeleteBusinessFn({ data: { token, businessId: business.id } });
      toast.success("Empresa eliminada");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!business} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Administrar empresa</DialogTitle>
          <DialogDescription>
            Datos de gestión, estado de pagos y del servicio. Inicio:{" "}
            {new Date(business.created_at).toLocaleDateString("es-CO")}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Nombre de la empresa</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Teléfono</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+57…" />
            </div>
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@empresa.com" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Estado de pagos</Label>
            <select
              value={payment}
              onChange={(e) => setPayment(e.target.value as "up_to_date" | "overdue")}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="up_to_date">Al día</option>
              <option value="overdue">Atrasado</option>
            </select>
          </div>
          <Button onClick={save} disabled={busy}>
            {busy ? "Guardando…" : "Guardar datos"}
          </Button>
        </div>

        <div className="mt-2 space-y-2 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">Acciones del servicio</p>
          <Button variant="outline" className="w-full gap-2" disabled={busy} onClick={togglePause}>
            {paused ? (
              <>
                <Play className="h-4 w-4" /> Reactivar servicio
              </>
            ) : (
              <>
                <Pause className="h-4 w-4" /> Pausar servicio (por falta de pago)
              </>
            )}
          </Button>

          {!confirmDel ? (
            <Button
              variant="ghost"
              className="w-full gap-2 text-red-600 hover:text-red-700"
              disabled={busy}
              onClick={() => setConfirmDel(true)}
            >
              <Trash2 className="h-4 w-4" /> Eliminar empresa
            </Button>
          ) : (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
              <p className="text-xs text-red-600 dark:text-red-400">
                ⚠️ Se eliminará <strong>{business.name}</strong> con todos sus clientes e historial.
                Esta acción no se puede deshacer.
              </p>
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirmDel(false)} disabled={busy}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="bg-red-600 text-white hover:bg-red-700"
                  onClick={del}
                  disabled={busy}
                >
                  Sí, eliminar definitivamente
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Gestión completa de un negocio desde el admin (reusa el Dashboard del comercio).
function AdminManage({
  businessId,
  email,
  onBack,
}: {
  businessId: string;
  email: string;
  onBack: () => void;
}) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const res = await adminGetBusinessFn({ data: { token, businessId } });
      setBusiness(res.business);
      setProgram(res.program);
      setMembers(res.members);
    } catch {
      setBusiness(null);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">Cargando…</div>
    );
  }
  if (!business) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <p className="text-sm text-muted-foreground">No se encontró el negocio.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onBack}>
            Volver al admin
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Dashboard
      business={business}
      program={program}
      members={members}
      email={email}
      reload={load}
      onBack={onBack}
    />
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <Icon className="h-5 w-5 text-primary" />
      <p className="mt-2 text-2xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function BusinessCard({
  business,
  onManage,
  onAdmin,
}: {
  business: BusinessRow;
  onManage: () => void;
  onAdmin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const program = business.programs[0];
  const members = business.programs.flatMap((p) => p.members);
  const paused = business.status === "paused";
  const overdue = business.payment_status === "overdue";

  return (
    <div className={`rounded-xl border bg-card ${paused ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg font-bold text-white"
          style={{ backgroundColor: business.brand_color }}
        >
          {business.name.charAt(0)}
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <p className="flex items-center gap-2 truncate font-semibold">
            {business.name}
            {paused ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                Pausado
              </span>
            ) : null}
            {overdue ? (
              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                Pago atrasado
              </span>
            ) : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {program
              ? `${program.name} · ${program.stamps_required} sellos = ${program.reward_description}`
              : "Sin programa"}
          </p>
          <span className="text-[11px] text-muted-foreground">
            {members.length} clientes · desde {new Date(business.created_at).toLocaleDateString("es-CO")} ·{" "}
            {open ? "ocultar ▲" : "ver clientes ▼"}
          </span>
        </button>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1" onClick={onAdmin}>
            <Pencil className="h-4 w-4" />
            <span className="hidden sm:inline">Administrar</span>
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={onManage}>
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Gestionar</span>
          </Button>
        </div>
      </div>

      {open ? (
        <div className="border-t px-4 py-2">
          {members.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">Sin clientes inscritos.</p>
          ) : (
            <ul className="divide-y">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="truncate">{m.full_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.stamps}/{program?.stamps_required ?? "?"} sellos · {m.rewards_redeemed} premios
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="py-1 text-[11px] text-muted-foreground">
            Inscripción: <code>/unirse/{business.slug}</code>
          </p>
        </div>
      ) : null}
    </div>
  );
}

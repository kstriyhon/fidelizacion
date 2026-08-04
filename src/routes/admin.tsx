import { useEffect, useState, useCallback } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { ShieldCheck, ArrowLeft, LogOut, Store, Users, Stamp, Gift, Plus, Settings } from "lucide-react";

import { useSession, signOut, getAccessToken } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admins";
import type { Business, Member, Program } from "@/lib/data";
import { adminListFn, adminGetBusinessFn } from "@/lib/loyaltyActions";
import { Button } from "@/components/ui/button";
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
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Store} label="Negocios" value={rows?.length ?? "—"} />
          <StatCard icon={Users} label="Clientes" value={totalMembers ?? "—"} />
          <StatCard icon={Stamp} label="Sellos activos" value={totalStamps ?? "—"} />
          <StatCard icon={Gift} label="Premios canjeados" value={totalRewards ?? "—"} />
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
              <BusinessCard key={b.id} business={b} onManage={() => setView({ t: "manage", id: b.id })} />
            ))}
            {rows && rows.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">No hay negocios todavía.</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
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

function BusinessCard({ business, onManage }: { business: BusinessRow; onManage: () => void }) {
  const [open, setOpen] = useState(false);
  const program = business.programs[0];
  const members = business.programs.flatMap((p) => p.members);

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-3 p-4">
        <div
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg font-bold text-white"
          style={{ backgroundColor: business.brand_color }}
        >
          {business.name.charAt(0)}
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <p className="truncate font-semibold">{business.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {program
              ? `${program.name} · ${program.stamps_required} sellos = ${program.reward_description}`
              : "Sin programa"}
          </p>
          <span className="text-[11px] text-muted-foreground">
            {members.length} clientes · {open ? "ocultar ▲" : "ver clientes ▼"}
          </span>
        </button>
        <Button size="sm" variant="outline" className="gap-1" onClick={onManage}>
          <Settings className="h-4 w-4" />
          <span className="hidden sm:inline">Gestionar</span>
        </Button>
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

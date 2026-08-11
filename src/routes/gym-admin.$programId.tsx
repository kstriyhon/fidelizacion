import { useEffect, useState, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Users,
  Calendar,
  TrendingUp,
  Settings,
  Plus,
  MoreVertical,
  LogOut,
  AlertCircle,
  CheckCircle,
  Clock,
  Gift,
  FileText,
  RefreshCw,
} from "lucide-react";

import { useSession, signOut, getAccessToken } from "@/lib/auth";
import {
  getGymAdminDashboardFn,
  createMembershipFn,
  updateMembershipPaymentStatusFn,
  getMonthlyAttendanceReportFn,
} from "@/lib/gymActions";
import type { Membership } from "@/lib/gym-data";
import type { Member, Program } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/gym-admin/$programId")({
  component: GymAdminPanel,
});

interface MemberWithMembership extends Member {
  membership: Membership | null;
  lastAttendance: string | null;
  sessionsThisMonth: number;
}

function GymAdminPanel() {
  const { programId } = Route.useParams();
  const navigate = useNavigate();
  const session = useSession();

  const [program, setProgram] = useState<Program | null>(null);
  const [members, setMembers] = useState<MemberWithMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [report, setReport] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (session === null) navigate({ to: "/login" });
  }, [session, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getGymAdminDashboardFn({
        data: { programId, token: await getAccessToken() },
      });
      setProgram(data.program);

      const memberMap = new Map(data.memberships.map((m: any) => [m.member_id, m]));
      const attendanceByMember = new Map<string, Set<string>>();
      const lastAttendanceByMember = new Map<string, string>();

      data.attendance.forEach((a: any) => {
        if (a.event_type === "check_in") {
          const date = a.timestamp_at.split("T")[0];
          if (!attendanceByMember.has(a.member_id)) {
            attendanceByMember.set(a.member_id, new Set());
          }
          attendanceByMember.get(a.member_id)!.add(date);
          lastAttendanceByMember.set(a.member_id, a.timestamp_at);
        }
      });

      const enrichedMembers = data.members.map((m: any) => ({
        ...m,
        membership: memberMap.get(m.id) ?? null,
        lastAttendance: lastAttendanceByMember.get(m.id) ?? null,
        sessionsThisMonth: attendanceByMember.get(m.id)?.size ?? 0,
      }));

      setMembers(enrichedMembers);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  const handleGenerateReport = async () => {
    setStatsLoading(true);
    try {
      const data = await getMonthlyAttendanceReportFn({
        data: { programId, token: await getAccessToken() },
      });
      setReport(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setStatsLoading(false);
    }
  };

  const filteredMembers = members.filter((m) =>
    `${m.full_name} ${m.phone ?? ""} ${m.email ?? ""}`
      .toLowerCase()
      .includes(searchQuery.toLowerCase()),
  );

  const activeMemberships = members.filter((m) => {
    if (!m.membership) return false;
    const expiresAt = new Date(m.membership.expires_at);
    return expiresAt > new Date();
  }).length;

  const expiringSoon = members.filter((m) => {
    if (!m.membership) return false;
    const expiresAt = new Date(m.membership.expires_at);
    const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return daysLeft > 0 && daysLeft <= 7;
  }).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Cargando...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-red-600">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{program?.name || "Gimnasio"}</h1>
            <p className="text-sm text-muted-foreground">Panel administrativo</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            <LogOut className="w-4 h-4 mr-2" />
            Salir
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <KPICard
            icon={<Users className="w-5 h-5" />}
            label="Total Miembros"
            value={members.length}
          />
          <KPICard
            icon={<CheckCircle className="w-5 h-5" />}
            label="Activos"
            value={activeMemberships}
          />
          <KPICard
            icon={<AlertCircle className="w-5 h-5" />}
            label="Vencen pronto"
            value={expiringSoon}
            warning={expiringSoon > 0}
          />
          <KPICard
            icon={<TrendingUp className="w-5 h-5" />}
            label="Asistencias hoy"
            value={members.filter((m) => {
              if (!m.lastAttendance) return false;
              const today = new Date().toISOString().split("T")[0];
              return m.lastAttendance.startsWith(today);
            }).length}
          />
        </div>

        <Tabs defaultValue="members" className="space-y-4">
          <TabsList>
            <TabsTrigger value="members">
              <Users className="w-4 h-4 mr-2" />
              Miembros
            </TabsTrigger>
            <TabsTrigger value="report">
              <FileText className="w-4 h-4 mr-2" />
              Reportes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Buscar por nombre, teléfono o email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Nuevo
              </Button>
            </div>

            <div className="rounded-lg border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted border-b">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Nombre</th>
                      <th className="px-4 py-3 text-left font-medium">Membresía</th>
                      <th className="px-4 py-3 text-left font-medium">Vencimiento</th>
                      <th className="px-4 py-3 text-left font-medium">Estado</th>
                      <th className="px-4 py-3 text-left font-medium">Sesiones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredMembers.map((member) => {
                      const membership = member.membership;
                      const isActive =
                        membership && new Date(membership.expires_at) > new Date();
                      const daysLeft = membership
                        ? Math.ceil(
                            (new Date(membership.expires_at).getTime() - Date.now()) /
                              (24 * 60 * 60 * 1000),
                          )
                        : null;

                      return (
                        <tr key={member.id} className="hover:bg-muted/50">
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium">{member.full_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {member.phone || member.email}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {membership ? (
                              <span className="text-xs bg-blue-500/15 text-blue-700 dark:text-blue-400 px-2 py-1 rounded">
                                {membership.membership_type === "monthly"
                                  ? "Mensual"
                                  : membership.membership_type === "quarterly"
                                    ? "Trimestral"
                                    : "Anual"}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Sin membresía</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {membership ? (
                              <div>
                                <p className="text-sm">
                                  {new Date(membership.expires_at).toLocaleDateString("es-ES")}
                                </p>
                                <p
                                  className={`text-xs ${
                                    isActive && daysLeft! <= 7
                                      ? "text-yellow-600"
                                      : isActive
                                        ? "text-green-600"
                                        : "text-red-600"
                                  }`}
                                >
                                  {isActive
                                    ? `${daysLeft} días`
                                    : daysLeft && daysLeft < 0
                                      ? "Vencida"
                                      : "Vence hoy"}
                                </p>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {membership ? (
                              <span
                                className={`text-xs px-2 py-1 rounded ${
                                  membership.payment_status === "up_to_date"
                                    ? "bg-green-500/15 text-green-700 dark:text-green-400"
                                    : membership.payment_status === "paused"
                                      ? "bg-gray-500/15 text-gray-700 dark:text-gray-400"
                                      : "bg-red-500/15 text-red-700 dark:text-red-400"
                                }`}
                              >
                                {membership.payment_status === "up_to_date"
                                  ? "Al día"
                                  : membership.payment_status === "paused"
                                    ? "Pausada"
                                    : "Vencida"}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div>
                              <p className="font-medium">{member.sessionsThisMonth}</p>
                              <p className="text-xs text-muted-foreground">este mes</p>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="report" className="space-y-4">
            <div className="flex gap-2 mb-4">
              <Button onClick={handleGenerateReport} disabled={statsLoading}>
                {statsLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Generando...
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4 mr-2" />
                    Generar Reporte del Mes
                  </>
                )}
              </Button>
            </div>

            {report && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <KPICard label="Total Miembros" value={report.totalMembers} />
                  <KPICard label="Asistieron" value={report.attendedThisMonth} />
                  <KPICard
                    label="% Asistencia"
                    value={`${Math.round((report.attendedThisMonth / report.totalMembers) * 100)}%`}
                  />
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function KPICard({
  icon,
  label,
  value,
  warning,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string | number;
  warning?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-4 ${
        warning ? "border-yellow-500/30 bg-yellow-500/5" : ""
      }`}
    >
      {icon && <div className="flex justify-start mb-2 text-muted-foreground">{icon}</div>}
      <p className={`text-2xl font-bold ${warning ? "text-yellow-600" : ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

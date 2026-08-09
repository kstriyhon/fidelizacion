import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  LogOut,
  Clock,
  Calendar,
  TrendingUp,
  Share2,
  Copy,
  Users,
  Gift,
  CheckCircle,
  AlertCircle,
  Zap,
} from "lucide-react";

import { getGymMemberDashboardFn, checkInMemberFn, checkOutMemberFn, getOrCreateReferralCodeFn } from "@/lib/gymActions";
import { computeAttendanceMetrics, isMembershipActive, daysUntilExpiration, membershipProgressPercent } from "@/lib/gym-metrics";
import type { Membership, AttendanceSession, Referral } from "@/lib/gym-data";
import type { Member, Program } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/gym/$memberId")({
  component: GymMemberDashboard,
});

function GymMemberDashboard() {
  const { memberId } = Route.useParams();
  const navigate = useNavigate();

  const [member, setMember] = useState<Member | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getGymMemberDashboardFn({ memberId });
      setMember(data.member);
      setProgram(data.program);
      setMembership(data.membership);
      setSessions(data.recentSessions);
      setReferrals(data.referrals);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [memberId]);

  const handleCheckIn = async () => {
    setCheckingIn(true);
    try {
      await checkInMemberFn({ memberId });
      toast.success("✅ Entrada registrada");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al hacer check-in");
    } finally {
      setCheckingIn(false);
    }
  };

  const handleCheckOut = async () => {
    setCheckingOut(true);
    try {
      const result = await checkOutMemberFn({ memberId });
      toast.success(`✅ Salida registrada (${result.durationMinutes} min)`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al hacer check-out");
    } finally {
      setCheckingOut(false);
    }
  };

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(`https://tudominio.com/referir/${code}`);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
    toast.success("Código copiado");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Cargando...</div>
      </div>
    );
  }

  if (!member || !program) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div className="text-muted-foreground">Miembro no encontrado</div>
        <Button onClick={() => navigate({ to: "/" })}>Volver al inicio</Button>
      </div>
    );
  }

  const metrics = computeAttendanceMetrics(sessions);
  const membershipActive = membership ? isMembershipActive(membership) : false;
  const daysLeft = membership ? daysUntilExpiration(membership) : null;
  const progressPercent = membership ? membershipProgressPercent(membership) : 0;
  const primaryReferral = referrals.find((r) => r.status === "pending");

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5 px-4 py-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{member.full_name}</h1>
            <p className="text-muted-foreground">{program.name}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>

        {/* Membresía */}
        {membership ? (
          <div
            className={`rounded-2xl border-2 p-6 ${
              membershipActive
                ? "border-green-500/30 bg-green-500/5"
                : "border-red-500/30 bg-red-500/5"
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground uppercase tracking-wide">
                  {membership.membership_type === "monthly"
                    ? "Mensual"
                    : membership.membership_type === "quarterly"
                      ? "Trimestral"
                      : "Anual"}
                </p>
                <p className="text-2xl font-bold mt-1">
                  {membershipActive ? "Activa" : "Vencida"}
                </p>
              </div>
              {membershipActive ? (
                <CheckCircle className="w-6 h-6 text-green-600" />
              ) : (
                <AlertCircle className="w-6 h-6 text-red-600" />
              )}
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Vigencia</span>
                  <span className="text-sm font-medium">{progressPercent}%</span>
                </div>
                <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      membershipActive ? "bg-green-500" : "bg-red-500"
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <p className="text-xs text-muted-foreground">Desde</p>
                  <p className="text-sm font-medium">
                    {new Date(membership.started_at).toLocaleDateString("es-ES")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Vencimiento</p>
                  <p className={`text-sm font-medium ${!membershipActive ? "text-red-600" : ""}`}>
                    {new Date(membership.expires_at).toLocaleDateString("es-ES")}
                    {daysLeft !== null && membershipActive && (
                      <span className="text-xs text-muted-foreground ml-2">({daysLeft} días)</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-muted p-6 text-center">
            <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">Sin membresía activa</p>
          </div>
        )}

        {/* Check-in / Check-out */}
        {membershipActive && (
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={handleCheckIn}
              disabled={checkingIn}
              className="h-16 text-lg font-semibold"
              variant="default"
            >
              {checkingIn ? "Registrando..." : "✅ Entrada"}
            </Button>
            <Button
              onClick={handleCheckOut}
              disabled={checkingOut}
              className="h-16 text-lg font-semibold"
              variant="outline"
            >
              {checkingOut ? "Registrando..." : "👋 Salida"}
            </Button>
          </div>
        )}

        {/* Métricas de Asistencia */}
        {sessions.length > 0 && (
          <div className="rounded-2xl border bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Asistencia
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricBox
                icon={<Zap className="w-4 h-4" />}
                label="Racha"
                value={`${metrics.streak_current}d`}
              />
              <MetricBox
                icon={<TrendingUp className="w-4 h-4" />}
                label="Esta semana"
                value={metrics.sessions_this_week}
              />
              <MetricBox
                icon={<Clock className="w-4 h-4" />}
                label="Duración promedio"
                value={metrics.avg_duration_minutes ? `${metrics.avg_duration_minutes}m` : "—"}
              />
              <MetricBox
                icon={<Calendar className="w-4 h-4" />}
                label="Total"
                value={metrics.total_sessions}
              />
            </div>

            {/* Últimas asistencias */}
            <div className="border-t pt-4">
              <h3 className="font-medium mb-3 text-sm">Últimas sesiones</h3>
              <ul className="space-y-2">
                {sessions.slice(0, 5).map((session) => (
                  <li key={session.date} className="flex items-center justify-between text-sm p-2 bg-secondary/50 rounded">
                    <span>{new Date(session.date).toLocaleDateString("es-ES", { weekday: "short", month: "short", day: "numeric" })}</span>
                    <span className="text-muted-foreground">
                      {session.check_in && session.check_in.split("T")[1].substring(0, 5)}
                      {session.duration_minutes && ` • ${session.duration_minutes}m`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Referidos */}
        <div className="rounded-2xl border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="w-5 h-5" />
            Referidos
          </h2>

          {primaryReferral ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Tu código para invitar amigos:</p>

              <div className="rounded-lg border-2 border-dashed border-primary/50 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-lg font-bold">{primaryReferral.referral_code}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCopyCode(primaryReferral.referral_code)}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>

                <div className="bg-secondary/50 p-3 rounded text-sm text-muted-foreground">
                  Comparte este código en WhatsApp o redes sociales. Tu amigo recibirá{" "}
                  <span className="font-semibold text-foreground">
                    {primaryReferral.reward_type === "discount"
                      ? `${primaryReferral.reward_value}% descuento`
                      : primaryReferral.reward_type === "stamps"
                        ? `${primaryReferral.reward_value} sellos`
                        : `${primaryReferral.reward_value} días gratis`}
                  </span>
                </div>

                <Button className="w-full" size="sm">
                  <Share2 className="w-4 h-4 mr-2" />
                  Compartir por WhatsApp
                </Button>
              </div>

              {/* QR Code */}
              <div className="flex justify-center py-4">
                <div className="bg-white p-3 rounded-lg">
                  <QRCodeSVG
                    value={`https://tudominio.com/referir/${primaryReferral.referral_code}`}
                    size={150}
                    level="H"
                    includeMargin
                  />
                </div>
              </div>

              {/* Resumen de referidos */}
              {referrals.length > 0 && (
                <div className="border-t pt-4 space-y-2">
                  <p className="text-sm font-medium">Mis invitaciones</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center p-2 bg-secondary/50 rounded">
                      <p className="text-xl font-bold">{referrals.filter((r) => r.status === "pending").length}</p>
                      <p className="text-xs text-muted-foreground">Pendientes</p>
                    </div>
                    <div className="text-center p-2 bg-secondary/50 rounded">
                      <p className="text-xl font-bold">{referrals.filter((r) => r.status === "activated").length}</p>
                      <p className="text-xs text-muted-foreground">Activos</p>
                    </div>
                    <div className="text-center p-2 bg-secondary/50 rounded">
                      <p className="text-xl font-bold">{referrals.filter((r) => r.status === "claimed").length}</p>
                      <p className="text-xs text-muted-foreground">Canjeados</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center p-6 bg-secondary/50 rounded-lg">
              <Gift className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">No tienes código de referido</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground pb-4">
          <p>v1.0 • {program.business_id}</p>
        </div>
      </div>
    </div>
  );
}

function MetricBox({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border bg-secondary/50 p-3 text-center">
      <div className="flex justify-center mb-1 text-muted-foreground">{icon}</div>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

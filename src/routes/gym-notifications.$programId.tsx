import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Bell,
  MessageCircle,
  Mail,
  Smartphone,
  Send,
  Clock,
  AlertCircle,
  Eye,
  Settings,
  Play,
  Loader,
  LogOut,
} from "lucide-react";

import { useSession, signOut } from "@/lib/auth";
import {
  getNotificationConfigFn,
  updateNotificationConfigFn,
  getNotificationHistoryFn,
  triggerExpirationNotificationsFn,
  getExpirationMessage,
  DEFAULT_EXPIRATION_TEMPLATE,
  type GymNotification,
  type NotificationChannel,
} from "@/lib/gym-notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/gym-notifications/$programId")({
  component: NotificationsPage,
});

const CHANNEL_ICON: Record<NotificationChannel, React.ReactNode> = {
  whatsapp: <MessageCircle className="w-4 h-4" />,
  sms: <Smartphone className="w-4 h-4" />,
  email: <Mail className="w-4 h-4" />,
};

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
};

const STATUS_STYLE: Record<string, string> = {
  sent: "bg-green-500/15 text-green-700 dark:text-green-400",
  pending: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  failed: "bg-red-500/15 text-red-700 dark:text-red-400",
  bounced: "bg-red-500/15 text-red-700 dark:text-red-400",
};

const STATUS_LABEL: Record<string, string> = {
  sent: "✅ Enviada",
  pending: "⏳ Pendiente",
  failed: "❌ Fallida",
  bounced: "⚠️ Rechazada",
};

function NotificationsPage() {
  const { programId } = Route.useParams();
  const navigate = useNavigate();
  const session = useSession();

  const [history, setHistory] = useState<GymNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);

  // Estado del formulario
  const [enabled, setEnabled] = useState(true);
  const [channel, setChannel] = useState<NotificationChannel>("whatsapp");
  const [alertDays, setAlertDays] = useState(7);
  const [reminderMsg, setReminderMsg] = useState("");
  const [welcomeEnabled, setWelcomeEnabled] = useState(true);
  const [welcomeMsg, setWelcomeMsg] = useState("");
  const [notifTime, setNotifTime] = useState("09:00");

  useEffect(() => {
    if (session === null) navigate({ to: "/login" });
  }, [session, navigate]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await getNotificationConfigFn({ data: { programId } });
      setEnabled(cfg.enabled);
      setChannel(cfg.preferred_channel);
      setAlertDays(cfg.alert_days);
      setReminderMsg(cfg.reminder_message ?? "");
      setWelcomeEnabled(cfg.send_welcome_msg);
      setWelcomeMsg(cfg.welcome_message ?? "");
      setNotifTime(cfg.notification_time);

      const hist = await getNotificationHistoryFn({ data: { programId, limit: 20 } });
      setHistory(hist);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateNotificationConfigFn({
        data: {
          programId,
          enabled,
          preferredChannel: channel,
          alertDays,
          reminderMessage: reminderMsg,
          sendWelcomeMsg: welcomeEnabled,
          welcomeMessage: welcomeMsg,
          notificationTime: notifTime,
        },
      });
      toast.success("✅ Configuración guardada");
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      const result = await triggerExpirationNotificationsFn({ data: { programId } });
      toast.success(
        `Enviadas: ${result.sent} · Saltadas: ${result.skipped} · Fallidas: ${result.failed}`,
      );
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al disparar notificaciones");
    } finally {
      setTriggering(false);
    }
  };

  // Vista previa con datos de ejemplo.
  const preview = getExpirationMessage(
    "María González",
    alertDays,
    new Date(Date.now() + alertDays * 24 * 60 * 60 * 1000),
    "tu gimnasio",
    reminderMsg || undefined,
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Cargando configuración...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-bold text-red-600">Error</h1>
        <p className="text-muted-foreground text-center max-w-md">{error}</p>
        <Button onClick={() => navigate({ to: "/" })}>Volver al inicio</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-6 h-6" />
            <div>
              <h1 className="text-2xl font-bold">Notificaciones</h1>
              <p className="text-sm text-muted-foreground">
                Recordatorios de vencimiento de membresía
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            <LogOut className="w-4 h-4 mr-2" />
            Salir
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <Tabs defaultValue="settings" className="space-y-4">
          <TabsList>
            <TabsTrigger value="settings">
              <Settings className="w-4 h-4 mr-2" />
              Configuración
            </TabsTrigger>
            <TabsTrigger value="history">
              <Eye className="w-4 h-4 mr-2" />
              Historial ({history.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-6">
            <div className="bg-card rounded-lg border p-6 space-y-6">
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Bell className="w-5 h-5" />
                  <div>
                    <p className="font-medium">Estado de notificaciones</p>
                    <p className="text-sm text-muted-foreground">
                      {enabled ? "Habilitadas" : "Deshabilitadas"}
                    </p>
                  </div>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              <div className="border-t pt-6 space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Alertas
                </h3>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="alert-days">Avisar con X días de antelación</Label>
                    <Input
                      id="alert-days"
                      type="number"
                      min={1}
                      max={30}
                      value={alertDays}
                      onChange={(e) => setAlertDays(Number(e.target.value))}
                      className="mt-2"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Avisará a quien venza en los próximos {alertDays} días.
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="channel">Canal preferido</Label>
                    <Select
                      value={channel}
                      onValueChange={(v) => setChannel(v as NotificationChannel)}
                    >
                      <SelectTrigger id="channel" className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                        <SelectItem value="sms">SMS</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-2">
                      Hoy solo WhatsApp está implementado (enlace wa.me manual).
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="notif-time" className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Hora de envío (UTC)
                    </Label>
                    <Input
                      id="notif-time"
                      type="time"
                      value={notifTime}
                      onChange={(e) => setNotifTime(e.target.value)}
                      className="mt-2"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-6 space-y-3">
                <h3 className="font-semibold">Mensaje de recordatorio</h3>
                <p className="text-xs text-muted-foreground">
                  Variables: {"{nombre}"} · {"{dias}"} · {"{fecha}"} · {"{negocio}"}. Déjalo vacío
                  para usar el mensaje por defecto.
                </p>
                <Textarea
                  rows={3}
                  placeholder={DEFAULT_EXPIRATION_TEMPLATE}
                  value={reminderMsg}
                  onChange={(e) => setReminderMsg(e.target.value)}
                />
                <div className="rounded-lg border bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Vista previa</p>
                  <p className="text-sm">{preview}</p>
                </div>
              </div>

              <div className="border-t pt-6 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">Mensaje de bienvenida</h3>
                    <p className="text-sm text-muted-foreground">
                      Se envía cuando alguien se inscribe
                    </p>
                  </div>
                  <Switch checked={welcomeEnabled} onCheckedChange={setWelcomeEnabled} />
                </div>

                {welcomeEnabled && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Variables: {"{nombre}"} · {"{negocio}"}
                    </p>
                    <Textarea
                      rows={2}
                      placeholder="¡Bienvenido {nombre} a {negocio}! 🏋️"
                      value={welcomeMsg}
                      onChange={(e) => setWelcomeMsg(e.target.value)}
                    />
                  </>
                )}
              </div>

              <div className="border-t pt-6">
                <Button onClick={handleSave} disabled={saving} size="lg">
                  {saving ? "Guardando..." : "💾 Guardar configuración"}
                </Button>
              </div>
            </div>

            <div className="bg-blue-500/5 border border-blue-500/30 rounded-lg p-6 space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Send className="w-5 h-5" />
                Disparar ahora
              </h3>
              <p className="text-sm text-muted-foreground">
                Registra un recordatorio para cada miembro cuya membresía venza dentro de{" "}
                {alertDays} días. No repite aviso si ya se mandó uno en las últimas 24 h.
              </p>
              <Button onClick={handleTrigger} disabled={triggering || !enabled}>
                {triggering ? (
                  <>
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Enviar notificaciones
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="bg-card rounded-lg border overflow-hidden">
              {history.length === 0 ? (
                <div className="text-center p-8 text-muted-foreground">
                  <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>Sin notificaciones enviadas aún</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted border-b">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Miembro</th>
                        <th className="px-4 py-3 text-left font-medium">Tipo</th>
                        <th className="px-4 py-3 text-left font-medium">Canal</th>
                        <th className="px-4 py-3 text-left font-medium">Estado</th>
                        <th className="px-4 py-3 text-left font-medium">Fecha</th>
                        <th className="px-4 py-3 text-left font-medium">Mensaje</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {history.map((notif) => (
                        <tr key={notif.id} className="hover:bg-muted/50">
                          <td className="px-4 py-3">
                            <p className="font-medium">
                              {notif.loyalty_members?.full_name ?? "—"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {notif.loyalty_members?.phone ?? "sin teléfono"}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {notif.notification_type === "expiration_reminder"
                              ? "Vencimiento"
                              : notif.notification_type === "welcome"
                                ? "Bienvenida"
                                : notif.notification_type}
                          </td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1 text-xs">
                              {CHANNEL_ICON[notif.channel]}
                              {CHANNEL_LABEL[notif.channel]}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-xs px-2 py-1 rounded ${STATUS_STYLE[notif.status] ?? ""}`}
                            >
                              {STATUS_LABEL[notif.status] ?? notif.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {new Date(notif.created_at).toLocaleDateString("es-ES", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="px-4 py-3 text-xs max-w-xs truncate">{notif.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
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
  CheckCircle2,
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
  type NotificationConfig,
  type GymNotification,
} from "@/lib/gym-notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/gym-notifications/$programId")({
  component: NotificationsPage,
});

function NotificationsPage() {
  const { programId } = Route.useParams();
  const navigate = useNavigate();
  const session = useSession();

  const [config, setConfig] = useState<NotificationConfig | null>(null);
  const [history, setHistory] = useState<GymNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewMessage, setPreviewMessage] = useState("");

  // Form state
  const [enabled, setEnabled] = useState(true);
  const [channel, setChannel] = useState<"whatsapp" | "sms" | "email">("whatsapp");
  const [alertDays, setAlertDays] = useState(7);
  const [reminderMsg, setReminderMsg] = useState("");
  const [welcomeEnabled, setWelcomeEnabled] = useState(true);
  const [welcomeMsg, setWelcomeMsg] = useState("");
  const [notifTime, setNotifTime] = useState("09:00");

  useEffect(() => {
    if (session === null) navigate({ to: "/login" });
  }, [session, navigate]);

  const loadData = async () => {
    setLoading(true);
    try {
      const cfg = await getNotificationConfigFn({ programId });
      setConfig(cfg);
      setEnabled(cfg.enabled);
      setChannel(cfg.preferred_channel);
      setAlertDays(cfg.alert_days);
      setReminderMsg(cfg.reminder_message || "");
      setWelcomeEnabled(cfg.send_welcome_msg);
      setWelcomeMsg(cfg.welcome_message || "");
      setNotifTime(cfg.notification_time);

      const hist = await getNotificationHistoryFn({ programId, limit: 20 });
      setHistory(hist);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al cargar configuración");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) loadData();
  }, [session, programId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateNotificationConfigFn({
        programId,
        enabled,
        preferredChannel: channel,
        alertDays,
        reminderMessage: reminderMsg || undefined,
        sendWelcomeMsg: welcomeEnabled,
        welcomeMessage: welcomeMsg || undefined,
        notificationTime: notifTime,
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
      const result = await triggerExpirationNotificationsFn({ programId });
      toast.success(
        `✅ Notificaciones enviadas: ${result.sent} enviadas, ${result.skipped} saltadas, ${result.failed} fallidas`,
      );
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al disparar notificaciones");
    } finally {
      setTriggering(false);
    }
  };

  const channelIcon = {
    whatsapp: <MessageCircle className="w-4 h-4" />,
    sms: <Smartphone className="w-4 h-4" />,
    email: <Mail className="w-4 h-4" />,
  };

  const statusColor = {
    sent: "bg-green-500/15 text-green-700 dark:text-green-400",
    pending: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    failed: "bg-red-500/15 text-red-700 dark:text-red-400",
    bounced: "bg-red-500/15 text-red-700 dark:text-red-400",
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Cargando configuración...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-6 h-6" />
            <div>
              <h1 className="text-2xl font-bold">Notificaciones</h1>
              <p className="text-sm text-muted-foreground">Gestionar recordatorios de vencimiento</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            <LogOut className="w-4 h-4 mr-2" />
            Salir
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Tabs defaultValue="settings" className="space-y-4">
          <TabsList>
            <TabsTrigger value="settings">
              <Settings className="w-4 h-4 mr-2" />
              Configuración
            </TabsTrigger>
            <TabsTrigger value="history">
              <Eye className="w-4 h-4 mr-2" />
              Historial
            </TabsTrigger>
          </TabsList>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
            <div className="bg-card rounded-lg border p-6 space-y-6">
              {/* Enable/Disable */}
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
                <button
                  onClick={() => setEnabled(!enabled)}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                    enabled ? "bg-green-500" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                      enabled ? "translate-x-7" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Alert Configuration */}
              <div className="border-t pt-6 space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Configuración de Alertas
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="alert-days">Alertar con X días antes</Label>
                    <Input
                      id="alert-days"
                      type="number"
                      min="1"
                      max="30"
                      value={alertDays}
                      onChange={(e) => setAlertDays(Number(e.target.value))}
                      className="mt-2"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Notificará membresías que vencen en {alertDays} días
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="channel">Canal preferido</Label>
                    <Select value={channel} onValueChange={(v: any) => setChannel(v)}>
                      <SelectTrigger id="channel" className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="whatsapp">
                          <div className="flex items-center gap-2">
                            <MessageCircle className="w-4 h-4" />
                            WhatsApp
                          </div>
                        </SelectItem>
                        <SelectItem value="sms">
                          <div className="flex items-center gap-2">
                            <Smartphone className="w-4 h-4" />
                            SMS
                          </div>
                        </SelectItem>
                        <SelectItem value="email">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            Email
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="col-span-2">
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

              {/* Reminder Message */}
              <div className="border-t pt-6 space-y-4">
                <h3 className="font-semibold">Mensaje de Recordatorio</h3>

                <div>
                  <Label htmlFor="reminder-msg">Plantilla personalizada (opcional)</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Variables disponibles: {"{nombre}"}, {"{dias}"}, {"{fecha}"}, {"{negocio}"}
                  </p>
                  <Textarea
                    id="reminder-msg"
                    placeholder="Hola {nombre}, tu membresía en {negocio} vence en {dias} días ({fecha}). Renuévala ahora 💪"
                    value={reminderMsg}
                    onChange={(e) => setReminderMsg(e.target.value)}
                    rows={3}
                  />
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPreviewMessage(reminderMsg || "Mensaje por defecto");
                    setShowPreview(true);
                  }}
                >
                  👁️ Ver previsualizacion
                </Button>
              </div>

              {/* Welcome Message */}
              <div className="border-t pt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">Mensaje de Bienvenida</h3>
                    <p className="text-sm text-muted-foreground">
                      Se envía cuando un miembro se inscribe
                    </p>
                  </div>
                  <button
                    onClick={() => setWelcomeEnabled(!welcomeEnabled)}
                    className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                      welcomeEnabled ? "bg-green-500" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                        welcomeEnabled ? "translate-x-7" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                {welcomeEnabled && (
                  <div>
                    <Label htmlFor="welcome-msg">Plantilla personalizada</Label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Variables: {"{nombre}"}, {"{negocio}"}
                    </p>
                    <Textarea
                      id="welcome-msg"
                      placeholder="¡Bienvenido {nombre} a {negocio}! 🏋️ Tu membresía está activa..."
                      value={welcomeMsg}
                      onChange={(e) => setWelcomeMsg(e.target.value)}
                      rows={2}
                    />
                  </div>
                )}
              </div>

              {/* Save Button */}
              <div className="border-t pt-6 flex gap-2">
                <Button onClick={handleSave} disabled={saving} size="lg">
                  {saving ? "Guardando..." : "💾 Guardar Configuración"}
                </Button>
              </div>
            </div>

            {/* Manual Trigger */}
            <div className="bg-blue-500/5 border border-blue-500/30 rounded-lg p-6 space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Send className="w-5 h-5" />
                Disparar Notificaciones Manualmente
              </h3>
              <p className="text-sm text-muted-foreground">
                Envía notificaciones de vencimiento a todos los miembros con membresía próxima a
                vencer basado en la configuración anterior.
              </p>
              <Button
                onClick={handleTrigger}
                disabled={triggering || !enabled}
                variant="default"
              >
                {triggering ? (
                  <>
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Enviar Notificaciones Ahora
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
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
                            <div>
                              <p className="font-medium">
                                {notif.loyalty_members?.full_name || "—"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {notif.loyalty_members?.phone || "sin teléfono"}
                              </p>
                            </div>
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
                              {channelIcon[notif.channel as "whatsapp" | "sms" | "email"]}
                              {notif.channel === "whatsapp"
                                ? "WhatsApp"
                                : notif.channel === "sms"
                                  ? "SMS"
                                  : "Email"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-xs px-2 py-1 rounded ${statusColor[notif.status as keyof typeof statusColor]}`}
                            >
                              {notif.status === "sent"
                                ? "✅ Enviada"
                                : notif.status === "pending"
                                  ? "⏳ Pendiente"
                                  : notif.status === "failed"
                                    ? "❌ Fallida"
                                    : "⚠️ Rechazada"}
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
                          <td className="px-4 py-3 text-xs max-w-xs truncate">
                            {notif.message}
                          </td>
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

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Previsualizacion del mensaje</DialogTitle>
            <DialogDescription>
              Así se verá el mensaje enviado al miembro
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted/50 rounded-lg p-4 space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Ejemplo de mensaje:</p>
              <div className="bg-white dark:bg-slate-900 rounded border p-3 text-sm">
                {previewMessage}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MessageCircle className="w-4 h-4" />
              <span>Se enviará por {channel === "whatsapp" ? "WhatsApp" : channel}</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

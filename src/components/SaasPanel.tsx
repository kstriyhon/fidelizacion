import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Edit2, FileText, Check, Trash2, Calendar } from "lucide-react";
import type { Business, Plan, Subscription, Invoice } from "@/lib/data";
import {
  listPlansFn,
  createSubscriptionFn,
  generateMonthlyInvoiceFn,
  markInvoicePaidFn,
  getSubscriptionDetailsFn,
} from "@/lib/loyaltyActions";
import { getAccessToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

type SubscriptionDetail = Subscription & { plan: Plan };

export function SaasPanel({ businesses }: { businesses: Business[] }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Map<string, SubscriptionDetail | null>>(new Map());
  const [invoices, setInvoices] = useState<Map<string, Invoice[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [showPlanDialog, setShowPlanDialog] = useState(false);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();

      // Cargar planes
      const plansData = await listPlansFn({ data: { token } });
      setPlans(plansData);

      // Cargar suscripciones e invoices para cada negocio
      const subsMap = new Map<string, SubscriptionDetail | null>();
      const invoicesMap = new Map<string, Invoice[]>();

      for (const biz of businesses) {
        const details = await getSubscriptionDetailsFn({ data: { token, businessId: biz.id } });
        subsMap.set(biz.id, details.subscription);
        invoicesMap.set(biz.id, details.invoices);
      }

      setSubscriptions(subsMap);
      setInvoices(invoicesMap);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error cargando suscripciones");
    } finally {
      setLoading(false);
    }
  }, [businesses]);

  useEffect(() => {
    load();
  }, [load]);

  async function createSub(businessId: string, planId: string) {
    setBusy(true);
    try {
      const token = await getAccessToken();
      await createSubscriptionFn({ data: { token, businessId, planId } });
      toast.success("Suscripción creada");
      setShowPlanDialog(false);
      setSelectedPlan(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function generateInvoice(subscriptionId: string) {
    setBusy(true);
    try {
      const token = await getAccessToken();
      await generateMonthlyInvoiceFn({ data: { token, subscriptionId } });
      toast.success("Factura generada");
      setShowInvoiceDialog(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(invoiceId: string) {
    setBusy(true);
    try {
      const token = await getAccessToken();
      await markInvoicePaidFn({ data: { token, invoiceId } });
      toast.success("Factura marcada como pagada");
      setShowPaymentDialog(false);
      setSelectedInvoice(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-center text-muted-foreground">Cargando suscripciones...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Gestión de Suscripciones SAAS</h2>

        <div className="space-y-4">
          {businesses.map((biz) => {
            const sub = subscriptions.get(biz.id);
            const bizInvoices = invoices.get(biz.id) ?? [];

            return (
              <div key={biz.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-semibold">{biz.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {sub ? `Plan: ${(sub as SubscriptionDetail).plan.name}` : "Sin suscripción"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelectedBusiness(biz);
                      setShowPlanDialog(true);
                    }}
                    className="gap-1"
                  >
                    <Plus className="h-4 w-4" />
                    {sub ? "Cambiar" : "Contratar"}
                  </Button>
                </div>

                {sub && (
                  <div className="bg-muted/50 rounded p-3 text-sm space-y-2 mb-3">
                    <p>
                      <strong>Plan:</strong> {(sub as SubscriptionDetail).plan.name} - ${(sub as SubscriptionDetail).plan.price_cop.toLocaleString()} COP/mes
                    </p>
                    <p>
                      <strong>Límites:</strong> {(sub as SubscriptionDetail).plan.max_programs} programas, {(sub as SubscriptionDetail).plan.max_members} clientes
                    </p>
                    <p>
                      <strong>Activa desde:</strong> {new Date((sub as SubscriptionDetail).started_at).toLocaleDateString()}
                    </p>
                  </div>
                )}

                {sub && (
                  <>
                    <div className="mb-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedBusiness(biz);
                          setShowInvoiceDialog(true);
                        }}
                        disabled={busy}
                        className="gap-1"
                      >
                        <FileText className="h-4 w-4" />
                        Generar factura
                      </Button>
                    </div>

                    {bizInvoices.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground">Facturas recientes:</p>
                        {bizInvoices.slice(0, 3).map((inv) => (
                          <div key={inv.id} className="flex justify-between items-center text-xs bg-background p-2 rounded">
                            <span>
                              {inv.month_year} - ${inv.amount_cop.toLocaleString()} COP
                              <span
                                className={`ml-2 px-2 py-1 rounded text-white ${
                                  inv.status === "paid"
                                    ? "bg-green-600"
                                    : inv.status === "pending"
                                      ? "bg-yellow-600"
                                      : "bg-red-600"
                                }`}
                              >
                                {inv.status === "paid" ? "Pagada" : inv.status === "pending" ? "Pendiente" : "Vencida"}
                              </span>
                            </span>
                            {inv.status === "pending" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSelectedInvoice(inv);
                                  setShowPaymentDialog(true);
                                }}
                                disabled={busy}
                                className="h-6 gap-1"
                              >
                                <Check className="h-3 w-3" />
                                Pagar
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Diálogo para cambiar plan */}
      <Dialog open={showPlanDialog} onOpenChange={setShowPlanDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contratar o cambiar plan</DialogTitle>
            <DialogDescription>{selectedBusiness?.name}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            {plans.map((plan) => (
              <button
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
                className={`p-3 rounded-lg border-2 transition ${
                  selectedPlan === plan.id
                    ? "border-primary bg-primary/10"
                    : "border-muted hover:border-muted-foreground"
                }`}
              >
                <div className="text-left">
                  <p className="font-semibold">{plan.name}</p>
                  <p className="text-sm text-muted-foreground">
                    ${plan.price_cop.toLocaleString()} COP/mes (primer mes gratis)
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {plan.max_programs} programas • {plan.max_members.toLocaleString()} clientes
                  </p>
                </div>
              </button>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPlanDialog(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              onClick={() =>
                selectedBusiness && selectedPlan && createSub(selectedBusiness.id, selectedPlan)
              }
              disabled={busy || !selectedPlan}
            >
              {busy ? "Procesando..." : "Contratar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo para generar factura */}
      <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generar factura</DialogTitle>
            <DialogDescription>{selectedBusiness?.name}</DialogDescription>
          </DialogHeader>

          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-blue-900">
              Se generará una factura con el monto del plan para el mes actual.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvoiceDialog(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                const sub = selectedBusiness && subscriptions.get(selectedBusiness.id);
                if (sub) generateInvoice(sub.id);
              }}
              disabled={busy}
            >
              {busy ? "Generando..." : "Generar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo para marcar como pagada */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar factura como pagada</DialogTitle>
          </DialogHeader>

          {selectedInvoice && (
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-sm font-semibold text-green-900">
                {selectedInvoice.month_year} - ${selectedInvoice.amount_cop.toLocaleString()} COP
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              onClick={() => selectedInvoice && markPaid(selectedInvoice.id)}
              disabled={busy}
            >
              {busy ? "Procesando..." : "Confirmar pago"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

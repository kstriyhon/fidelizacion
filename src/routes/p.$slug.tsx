import { useState } from "react";
import { createFileRoute, useNavigate, notFound } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Business, Program } from "@/lib/data";
import { authenticateBusinessFn } from "@/lib/loyaltyActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/p/$slug")({
  loader: async ({ params }) => {
    const { data: business } = await supabase
      .from("loyalty_businesses")
      .select("*")
      .eq("slug", params.slug)
      .maybeSingle();

    if (!business) throw notFound();

    const { data: programs } = await supabase
      .from("loyalty_programs")
      .select("*")
      .eq("business_id", business.id)
      .eq("active", true)
      .limit(1);

    if (!programs || programs.length === 0) throw notFound();

    return {
      business: business as Business,
      program: programs[0] as Program,
    };
  },
  component: DirectAccessPage,
});

function DirectAccessPage() {
  const { business, program } = Route.useLoaderData();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      toast.error("Ingresa usuario y contraseña");
      return;
    }

    setLoading(true);
    try {
      const result = await authenticateBusinessFn({
        data: { username: username.trim(), password: password.trim() },
      });

      // Guardar sesión en localStorage
      localStorage.setItem(
        "business_session",
        JSON.stringify({
          businessId: result.businessId,
          businessName: result.businessName,
          businessSlug: result.businessSlug,
          username: result.username,
          timestamp: Date.now(),
        })
      );

      // Guardar selectedBusinessId para que /comercio lo use
      localStorage.setItem("selectedBusinessId", result.businessId);

      toast.success(`¡Bienvenido ${result.businessName}!`);

      // Redirigir al programa del negocio
      navigate({
        to: "/comercio",
        search: (prev) => ({ ...prev, program: program.id, business: result.businessId }),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error de autenticación");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 px-6 py-10 flex items-center justify-center">
      <div className="mx-auto max-w-md w-full">
        <div className="rounded-xl border bg-card p-6">
          <h1 className="text-lg font-bold mb-1">{business.name}</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Acceso al panel de administración
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="grid gap-1.5">
              <Label>Usuario</Label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Tu usuario"
                disabled={loading}
                autoFocus
              />
            </div>

            <div className="grid gap-1.5">
              <Label>Contraseña</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Tu contraseña"
                disabled={loading}
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Verificando..." : "Entrar"}
            </Button>
          </form>

          <p className="mt-4 text-xs text-muted-foreground text-center">
            Credenciales configuradas en el panel de administrador
          </p>
        </div>
      </div>
    </div>
  );
}

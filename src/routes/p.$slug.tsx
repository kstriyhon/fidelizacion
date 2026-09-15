import { useEffect } from "react";
import { createFileRoute, useNavigate, notFound, redirect } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import type { Business, Program } from "@/lib/data";

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
  const session = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (session === undefined) return; // Aún cargando

    if (!session) {
      // No autenticado: redirigir a login
      navigate({ to: "/login" });
      return;
    }

    // Autenticado: ir directo al programa sin validación
    navigate({
      to: "/comercio",
      search: { program: program.id },
    });
  }, [session, program, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="text-center">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary mx-auto" />
        <p className="text-muted-foreground">Verificando acceso...</p>
      </div>
    </div>
  );
}

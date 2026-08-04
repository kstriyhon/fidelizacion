// Credenciales públicas de Supabase.
//
// La anon key es pública por diseño: viaja en el bundle del cliente y la
// protección real de los datos son las políticas RLS de Supabase. Se dejan aquí
// hardcodeadas (en vez de depender de variables VITE_* del build) porque en
// Cloudflare Workers Builds la inyección de la anon key resultó poco fiable y la
// app terminaba usando un cliente "stub" sin poder leer datos.
//
// Si en el futuro quieres apuntar a otro proyecto de Supabase, cambia estos dos
// valores (o vuelve a introducir la lógica de import.meta.env.VITE_*).

export const SUPABASE_URL = "https://solasuxfnoipziijibam.supabase.co";

export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvbGFzdXhmbm9pcHppaWppYmFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MjU5NjUsImV4cCI6MjEwMTAwMTk2NX0.iLnq9QtlH2A83F57l-RYbSGVv3hmJbCxMbCUcoR5mG0";

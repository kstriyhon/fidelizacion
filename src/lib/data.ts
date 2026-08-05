// Tipos compartidos del dominio (cliente y servidor).

export type Business = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  brand_color: string;
  contact_phone: string | null;
  created_at: string;
  // Gestión SaaS (admin)
  email: string | null;
  status: "active" | "paused";
  payment_status: "up_to_date" | "overdue";
  // Ubicación para alertas de proximidad (Google Wallet). null = sin alerta.
  latitude: number | null;
  longitude: number | null;
};

export type Program = {
  id: string;
  business_id: string;
  name: string;
  stamps_required: number;
  reward_description: string;
  active: boolean;
  wallet_class_id: string | null;
  /** Plantilla del mensaje push al dar un sello. null = mensaje por defecto.
   *  Variables: {sellos} {total} {faltan} {negocio} {premio} {nombre} */
  stamp_message: string | null;
  /** Mensaje de bienvenida al inscribirse. null = por defecto. Vars: {nombre} {negocio} */
  welcome_message: string | null;
  created_at: string;
};

export type Member = {
  id: string;
  program_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  stamps: number;
  rewards_redeemed: number;
  wallet_object_id: string | null;
  enrolled_at: string;
  last_stamp_at: string | null;
};

export type StampEvent = {
  id: string;
  member_id: string;
  delta: number;
  kind: "stamp" | "redeem" | "adjust";
  note: string | null;
  created_at: string;
};

/** Programa con su comercio (join usado en las páginas públicas y de servidor). */
export type ProgramWithBusiness = Program & { business: Business };

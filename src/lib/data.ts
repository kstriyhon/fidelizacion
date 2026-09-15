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
  // Credenciales de acceso al panel para este programa.
  // Usuario y contraseña para autenticación en el dashboard del programa.
  access_username: string | null;
  access_password: string | null;
};

export type Member = {
  id: string;
  program_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  birth_month: number | null;
  birth_day: number | null;
  stamps: number;
  rewards_redeemed: number;
  wallet_object_id: string | null;
  apple_pass_serial_number: string | null;
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

/** Plan de suscripción SAAS */
export type Plan = {
  id: string;
  name: string;
  price_cop: number;
  max_programs: number;
  max_members: number;
  description: string | null;
  active: boolean;
  created_at: string;
};

/** Suscripción de un negocio */
export type Subscription = {
  id: string;
  business_id: string;
  plan_id: string;
  status: "active" | "paused" | "cancelled";
  started_at: string;
  ended_at: string | null;
  created_at: string;
};

/** Factura de suscripción */
export type Invoice = {
  id: string;
  subscription_id: string;
  business_id: string;
  amount_cop: number;
  month_year: string;
  status: "pending" | "paid" | "overdue" | "cancelled";
  invoice_number: string | null;
  due_date: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
};

/** Programa con su comercio (join usado en las páginas públicas y de servidor). */
export type ProgramWithBusiness = Program & { business: Business };

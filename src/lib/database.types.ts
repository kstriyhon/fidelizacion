// Tipos generados de Supabase
export type Database = {
  public: {
    Tables: {
      loyalty_businesses: {
        Row: {
          id: string;
          name: string;
          slug: string;
          logo_url: string | null;
          brand_color: string;
          contact_phone: string | null;
          email: string | null;
          status: "active" | "paused";
          payment_status: "up_to_date" | "overdue";
          latitude: number | null;
          longitude: number | null;
          created_at: string;
        };
      };
      loyalty_programs: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          stamps_required: number;
          reward_description: string;
          active: boolean;
          wallet_class_id: string | null;
          stamp_message: string | null;
          welcome_message: string | null;
          created_at: string;
        };
      };
      loyalty_members: {
        Row: {
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
      };
      loyalty_stamp_events: {
        Row: {
          id: string;
          member_id: string;
          delta: number;
          kind: "stamp" | "redeem" | "adjust";
          note: string | null;
          created_at: string;
        };
      };
      gym_memberships: {
        Row: {
          id: string;
          member_id: string;
          membership_type: "monthly" | "quarterly" | "annual";
          started_at: string;
          expires_at: string;
          payment_status: "up_to_date" | "overdue" | "paused";
          amount_paid: number | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      gym_attendance: {
        Row: {
          id: string;
          member_id: string;
          timestamp_at: string;
          event_type: "check_in" | "check_out";
          duration_minutes: number | null;
          entry_method: "qr" | "manual" | "auto";
          created_at: string;
        };
      };
      gym_referrals: {
        Row: {
          id: string;
          referrer_id: string;
          referree_id: string | null;
          referral_code: string;
          reward_type: "discount" | "stamps" | "free_days";
          reward_value: number;
          status: "pending" | "activated" | "claimed";
          activated_at: string | null;
          claimed_at: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      gym_program_config: {
        Row: {
          id: string;
          program_id: string;
          monthly_days: number;
          quarterly_days: number;
          annual_days: number;
          monthly_price: number | null;
          quarterly_price: number | null;
          annual_price: number | null;
          notify_days: number;
          auto_checkin: boolean;
          auto_checkout_minutes: number;
          created_at: string;
          updated_at: string;
        };
      };
    };
  };
};

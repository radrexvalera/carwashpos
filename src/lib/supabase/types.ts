// Hand-written to match the migrations in supabase/migrations/. Once the Supabase CLI's local
// shadow-db workflow is usable in this environment, regenerate via:
//   npx supabase gen types typescript --linked > src/lib/supabase/types.ts
// Re-run that after every new migration.

export type Role = 'admin' | 'manager' | 'cashier'

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string
          name: string
          slug: string
          settings: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          settings?: Record<string, unknown>
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['tenants']['Insert']>
        Relationships: []
      }
      locations: {
        Row: {
          id: string
          tenant_id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name?: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['locations']['Insert']>
        Relationships: []
      }
      user_profiles: {
        Row: {
          id: string
          tenant_id: string
          role: Role
          full_name: string
          active: boolean
          created_at: string
        }
        Insert: {
          id: string
          tenant_id: string
          role: Role
          full_name: string
          active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['user_profiles']['Insert']>
        Relationships: []
      }
      permissions: {
        Row: { key: string; description: string }
        Insert: never
        Update: never
        Relationships: []
      }
      roles: {
        Row: {
          id: string
          tenant_id: string
          key: string
          name: string
          is_system: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          key: string
          name: string
          is_system?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['roles']['Insert']>
        Relationships: []
      }
      role_permissions: {
        Row: { role_id: string; permission_key: string }
        Insert: { role_id: string; permission_key: string }
        Update: never
        Relationships: []
      }
      employee_roles: {
        Row: { employee_id: string; role_id: string }
        Insert: { employee_id: string; role_id: string }
        Update: never
        Relationships: []
      }
      employees: {
        Row: {
          id: string
          tenant_id: string
          user_id: string | null
          employee_code: string | null
          full_name: string
          nickname: string | null
          mobile: string | null
          hire_date: string | null
          employment_status: 'active' | 'inactive' | 'terminated'
          active: boolean
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id?: string | null
          employee_code?: string | null
          full_name: string
          nickname?: string | null
          mobile?: string | null
          hire_date?: string | null
          employment_status?: 'active' | 'inactive' | 'terminated'
          active?: boolean
          notes?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['employees']['Insert']>
        Relationships: []
      }
      settings: {
        Row: {
          tenant_id: string
          business_name: string
          address: string | null
          contact_phone: string | null
          contact_email: string | null
          currency: string
          timezone: string
          receipt_header: string | null
          receipt_footer: string | null
          numbering_prefix: string
          updated_at: string
        }
        Insert: {
          tenant_id: string
          business_name?: string
          address?: string | null
          contact_phone?: string | null
          contact_email?: string | null
          currency?: string
          timezone?: string
          receipt_header?: string | null
          receipt_footer?: string | null
          numbering_prefix?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['settings']['Insert']>
        Relationships: []
      }
      vehicle_sizes: {
        Row: {
          id: string
          tenant_id: string
          name: string
          sort_order: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          sort_order?: number
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['vehicle_sizes']['Insert']>
        Relationships: []
      }
      vehicle_makes: {
        Row: {
          id: string
          tenant_id: string
          name: string
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['vehicle_makes']['Insert']>
        Relationships: []
      }
      vehicle_models: {
        Row: {
          id: string
          tenant_id: string
          make_id: string
          model_name: string
          vehicle_type: string | null
          default_vehicle_size_id: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          make_id: string
          model_name: string
          vehicle_type?: string | null
          default_vehicle_size_id?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['vehicle_models']['Insert']>
        Relationships: []
      }
      service_categories: {
        Row: {
          id: string
          tenant_id: string
          name: string
          sort_order: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          sort_order?: number
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['service_categories']['Insert']>
        Relationships: []
      }
      services: {
        Row: {
          id: string
          tenant_id: string
          name: string
          category: string | null
          category_id: string | null
          pricing_type: 'matrix' | 'flat' | 'starting_at' | 'quoted'
          flat_price: number | null
          default_duration_minutes: number | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          category?: string | null
          category_id?: string | null
          pricing_type?: 'matrix' | 'flat' | 'starting_at' | 'quoted'
          flat_price?: number | null
          default_duration_minutes?: number | null
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['services']['Insert']>
        Relationships: []
      }
      service_prices: {
        Row: {
          id: string
          tenant_id: string
          service_id: string
          vehicle_size_id: string
          price: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          service_id: string
          vehicle_size_id: string
          price: number
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['service_prices']['Insert']>
        Relationships: []
      }
      products: {
        Row: {
          id: string
          tenant_id: string
          sku: string | null
          name: string
          price: number
          cost: number | null
          stock_qty: number
          reorder_threshold: number | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          sku?: string | null
          name: string
          price: number
          cost?: number | null
          stock_qty?: number
          reorder_threshold?: number | null
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['products']['Insert']>
        Relationships: []
      }
      consumables: {
        Row: {
          id: string
          tenant_id: string
          name: string
          unit: string
          unit_cost: number
          stock_qty_book: number
          reorder_threshold: number | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          unit: string
          unit_cost?: number
          stock_qty_book?: number
          reorder_threshold?: number | null
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['consumables']['Insert']>
        Relationships: []
      }
      service_bom: {
        Row: {
          id: string
          tenant_id: string
          service_id: string
          consumable_id: string
          quantity_used: number
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          service_id: string
          consumable_id: string
          quantity_used: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['service_bom']['Insert']>
        Relationships: []
      }
      bays: {
        Row: {
          id: string
          tenant_id: string
          location_id: string
          name: string
          sort_order: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          location_id: string
          name: string
          sort_order?: number
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['bays']['Insert']>
        Relationships: []
      }
      tickets: {
        Row: {
          id: string
          tenant_id: string
          location_id: string
          client_generated_id: string
          ticket_number: number
          status: 'waiting' | 'in_bay' | 'ready_for_pickup' | 'picked_up_paid' | 'voided'
          bay_id: string | null
          bay_entered_at: string | null
          subtotal: number
          discount_total: number
          tax_total: number
          total: number
          created_by: string
          created_at: string
          completed_at: string | null
          voided_by: string | null
          voided_at: string | null
          void_reason: string | null
        }
        Insert: never
        Update: {
          status?: Database['public']['Tables']['tickets']['Row']['status']
          bay_id?: string | null
          bay_entered_at?: string | null
          completed_at?: string | null
        }
        Relationships: []
      }
      ticket_line_items: {
        Row: {
          id: string
          tenant_id: string
          ticket_id: string
          line_type: 'service' | 'product'
          service_id: string | null
          vehicle_size_class_id: string | null
          product_id: string | null
          unit_price: number
          quantity: number
          discount_amount: number
          line_total: number
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      ticket_payments: {
        Row: {
          id: string
          tenant_id: string
          ticket_id: string
          method: 'cash' | 'gcash' | 'maya' | 'bank_transfer' | 'card'
          amount: number
          reference_note: string | null
          paid_at: string
          recorded_by: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: {
      ticket_board_entries: {
        Row: {
          id: string
          tenant_id: string
          client_generated_id: string
          ticket_number: number
          status: Database['public']['Tables']['tickets']['Row']['status']
          bay_id: string | null
          bay_name: string | null
          bay_entered_at: string | null
          created_at: string
          completed_at: string | null
          total: number
          summary: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      complete_ticket: {
        Args: { payload: Json }
        Returns: Json
      }
      has_permission: {
        Args: { perm_key: string }
        Returns: boolean
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

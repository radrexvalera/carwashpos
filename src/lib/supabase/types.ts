// Hand-written to match supabase/migrations/0001_init_schema.sql until the project is linked to a
// real Supabase instance. Once it is, regenerate this file from the source of truth with:
//   npx supabase gen types typescript --linked > src/lib/supabase/types.ts
// Re-run that after every new migration (Phase 1+ will add tickets, shifts, promotions, etc.).

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
      vehicle_size_classes: {
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
        Update: Partial<Database['public']['Tables']['vehicle_size_classes']['Insert']>
        Relationships: []
      }
      services: {
        Row: {
          id: string
          tenant_id: string
          name: string
          category: string | null
          default_duration_minutes: number | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          category?: string | null
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
          vehicle_size_class_id: string
          price: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          service_id: string
          vehicle_size_class_id: string
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
    Views: Record<string, never>
    Functions: {
      complete_ticket: {
        Args: { payload: Json }
        Returns: Json
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

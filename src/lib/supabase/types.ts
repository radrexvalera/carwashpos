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
          trial_ends_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          settings?: Record<string, unknown>
          trial_ends_at?: string | null
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
          salary_rate: number | null
          salary_rate_type: 'daily' | 'weekly' | 'semi_monthly' | 'monthly' | null
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
          salary_rate?: number | null
          salary_rate_type?: 'daily' | 'weekly' | 'semi_monthly' | 'monthly' | null
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
          receipt_paper_width: string
          numbering_prefix: string
          loyalty_earn_rate: number
          loyalty_redemption_value: number
          carwash_commission_rate: number
          other_commission_rate: number
          onboarding_completed_at: string | null
          logo_url: string | null
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
          receipt_paper_width?: string
          numbering_prefix?: string
          loyalty_earn_rate?: number
          loyalty_redemption_value?: number
          carwash_commission_rate?: number
          other_commission_rate?: number
          onboarding_completed_at?: string | null
          logo_url?: string | null
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
          is_carwash: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          sort_order?: number
          is_active?: boolean
          is_carwash?: boolean
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
      inventory_categories: {
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
        Update: Partial<Database['public']['Tables']['inventory_categories']['Insert']>
        Relationships: []
      }
      inventory_units: {
        Row: {
          id: string
          tenant_id: string
          name: string
          abbreviation: string
          base_unit_id: string | null
          conversion_factor: number
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          abbreviation: string
          base_unit_id?: string | null
          conversion_factor?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['inventory_units']['Insert']>
        Relationships: []
      }
      inventory_items: {
        Row: {
          id: string
          tenant_id: string
          category_id: string | null
          name: string
          sku: string | null
          item_type: 'retail' | 'consumable' | 'reusable_equipment' | 'asset'
          unit_id: string
          retail_price: number | null
          min_stock: number | null
          reorder_level: number | null
          target_stock: number | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          category_id?: string | null
          name: string
          sku?: string | null
          item_type: 'retail' | 'consumable' | 'reusable_equipment' | 'asset'
          unit_id: string
          retail_price?: number | null
          min_stock?: number | null
          reorder_level?: number | null
          target_stock?: number | null
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['inventory_items']['Insert']>
        Relationships: []
      }
      inventory_transactions: {
        Row: {
          id: string
          tenant_id: string
          item_id: string
          transaction_type: string
          quantity_delta: number
          previous_qty: number
          new_qty: number
          unit_cost_at_time: number | null
          reference_type: string | null
          reference_id: string | null
          reason: string | null
          created_by: string
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      suppliers: {
        Row: {
          id: string
          tenant_id: string
          name: string
          contact_person: string | null
          mobile: string | null
          email: string | null
          address: string | null
          notes: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          contact_person?: string | null
          mobile?: string | null
          email?: string | null
          address?: string | null
          notes?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['suppliers']['Insert']>
        Relationships: []
      }
      purchase_orders: {
        Row: {
          id: string
          tenant_id: string
          supplier_id: string
          reference_number: string | null
          order_date: string
          subtotal: number
          discount_total: number
          delivery_charge: number
          total: number
          created_by: string
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          id: string
          tenant_id: string
          purchase_order_id: string
          item_id: string
          quantity: number
          unit_cost: number
          discount_amount: number
          line_total: number
        }
        Insert: never
        Update: never
        Relationships: []
      }
      service_recipe_items: {
        Row: {
          id: string
          tenant_id: string
          service_id: string
          vehicle_size_id: string | null
          item_id: string
          quantity_used: number
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          service_id: string
          vehicle_size_id?: string | null
          item_id: string
          quantity_used: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['service_recipe_items']['Insert']>
        Relationships: []
      }
      expense_categories: {
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
        Update: Partial<Database['public']['Tables']['expense_categories']['Insert']>
        Relationships: []
      }
      expenses: {
        Row: {
          id: string
          tenant_id: string
          category_id: string
          description: string
          amount: number
          expense_date: string
          payment_method: 'cash' | 'gcash' | 'maya' | 'bank_transfer' | 'card' | 'maribank' | 'gotyme' | 'rcbc' | 'bpi' | 'unionbank' | 'qrph'
          paid_to: string | null
          reference_note: string | null
          is_voided: boolean
          voided_by: string | null
          voided_at: string | null
          void_reason: string | null
          created_by: string
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      wash_bays: {
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
        Update: Partial<Database['public']['Tables']['wash_bays']['Insert']>
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
      customers: {
        Row: {
          id: string
          tenant_id: string
          customer_type: 'individual' | 'company'
          full_name: string
          mobile: string | null
          email: string | null
          address: string | null
          notes: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          customer_type?: 'individual' | 'company'
          full_name: string
          mobile?: string | null
          email?: string | null
          address?: string | null
          notes?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['customers']['Insert']>
        Relationships: []
      }
      vehicles: {
        Row: {
          id: string
          tenant_id: string
          customer_id: string | null
          plate_number: string
          make: string | null
          model: string | null
          year: number | null
          color: string | null
          vehicle_type: string | null
          vehicle_size_id: string | null
          notes: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          customer_id?: string | null
          plate_number: string
          make?: string | null
          model?: string | null
          year?: number | null
          color?: string | null
          vehicle_type?: string | null
          vehicle_size_id?: string | null
          notes?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['vehicles']['Insert']>
        Relationships: []
      }
      jobs: {
        Row: {
          id: string
          tenant_id: string
          location_id: string
          client_generated_id: string
          job_number: string
          vehicle_id: string
          vehicle_size_id: string
          bay_id: string | null
          status: 'waiting' | 'ongoing' | 'ready_for_release' | 'completed' | 'cancelled'
          bay_entered_at: string | null
          completed_at: string | null
          cancelled_at: string | null
          cancel_reason: string | null
          created_by: string
          created_at: string
        }
        Insert: never
        Update: {
          status?: Database['public']['Tables']['jobs']['Row']['status']
          bay_id?: string | null
          bay_entered_at?: string | null
          completed_at?: string | null
          cancelled_at?: string | null
          cancel_reason?: string | null
        }
        Relationships: []
      }
      job_services: {
        Row: {
          id: string
          tenant_id: string
          job_id: string
          service_id: string
          unit_price: number
          quantity: number
          discount_amount: number
          line_total: number
          status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
          started_at: string | null
          completed_at: string | null
          created_at: string
        }
        Insert: never
        Update: {
          status?: Database['public']['Tables']['job_services']['Row']['status']
          started_at?: string | null
          completed_at?: string | null
        }
        Relationships: []
      }
      job_service_attendants: {
        Row: {
          id: string
          tenant_id: string
          job_service_id: string
          employee_id: string
          role_in_job: string | null
          split_percentage: number | null
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          job_service_id: string
          employee_id: string
          role_in_job?: string | null
          split_percentage?: number | null
          created_at?: string
        }
        Update: never
        Relationships: []
      }
      job_status_history: {
        Row: {
          id: string
          tenant_id: string
          job_id: string
          from_status: string | null
          to_status: string
          changed_by: string
          changed_at: string
          note: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      cashier_shifts: {
        Row: {
          id: string
          tenant_id: string
          location_id: string
          cashier_id: string
          opened_at: string
          opening_float: number
          closed_at: string | null
          expected_cash: number | null
          counted_cash: number | null
          variance: number | null
          variance_reason: string | null
          status: 'open' | 'closed'
        }
        Insert: {
          id?: string
          tenant_id: string
          location_id: string
          cashier_id: string
          opened_at?: string
          opening_float?: number
        }
        Update: never
        Relationships: []
      }
      cash_movements: {
        Row: {
          id: string
          tenant_id: string
          shift_id: string
          type: 'cash_in' | 'cash_out'
          amount: number
          category: string
          reason: string | null
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          shift_id: string
          type: 'cash_in' | 'cash_out'
          amount: number
          category: string
          reason?: string | null
          created_by: string
          created_at?: string
        }
        Update: never
        Relationships: []
      }
      sales: {
        Row: {
          id: string
          tenant_id: string
          location_id: string
          client_generated_id: string
          sale_number: string
          job_id: string | null
          shift_id: string
          subtotal: number
          discount_total: number
          tax_total: number
          total: number
          status: 'completed' | 'voided' | 'refunded'
          created_by: string
          created_at: string
          voided_by: string | null
          voided_at: string | null
          void_reason: string | null
          refunded_by: string | null
          refunded_at: string | null
          refund_reason: string | null
          customer_id: string | null
          promotion_id: string | null
          promotion_discount_amount: number
          loyalty_points_redeemed: number
          loyalty_discount_amount: number
          billing_type: 'immediate' | 'on_account'
          payment_status: 'paid' | 'partial' | 'unpaid'
          membership_program_id: string | null
          membership_redeemed_job_service_id: string | null
          membership_discount_amount: number
          manual_discount_type: 'percentage' | 'fixed' | null
          manual_discount_value: number | null
          manual_discount_amount: number
        }
        Insert: never
        Update: never
        Relationships: []
      }
      sale_items: {
        Row: {
          id: string
          tenant_id: string
          sale_id: string
          line_type: 'job_service' | 'product'
          job_service_id: string | null
          item_id: string | null
          description: string
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
      payments: {
        Row: {
          id: string
          tenant_id: string
          sale_id: string
          method: 'cash' | 'gcash' | 'maya' | 'bank_transfer' | 'card' | 'maribank' | 'gotyme' | 'rcbc' | 'bpi' | 'unionbank' | 'qrph'
          amount: number
          reference_note: string | null
          tendered_amount: number | null
          change_given: number | null
          paid_at: string
          recorded_by: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      service_commission_rules: {
        Row: {
          id: string
          tenant_id: string
          service_id: string | null
          commission_type: 'fixed_pool' | 'percentage' | 'fixed_per_attendant' | 'points'
          rate: number
          basis: 'original_price' | 'discounted_price'
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          service_id?: string | null
          commission_type: 'fixed_pool' | 'percentage' | 'fixed_per_attendant' | 'points'
          rate: number
          basis?: 'original_price' | 'discounted_price'
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['service_commission_rules']['Insert']>
        Relationships: []
      }
      commission_ledger: {
        Row: {
          id: string
          tenant_id: string
          employee_id: string
          job_id: string
          job_service_id: string | null
          service_id: string | null
          gross_service_amount: number
          commission_type: string
          commission_rate: number
          commission_amount: number
          points: number | null
          status: 'pending' | 'earned' | 'approved' | 'paid' | 'reversed' | 'adjusted'
          payroll_period_id: string | null
          paid_date: string | null
          adjustment_reason: string | null
          reverses_ledger_id: string | null
          created_by: string
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      payroll_periods: {
        Row: {
          id: string
          tenant_id: string
          period_type: 'daily' | 'weekly' | 'semi_monthly' | 'custom'
          start_date: string
          end_date: string
          status: 'draft' | 'locked' | 'paid'
          locked_at: string | null
          locked_by: string | null
          paid_at: string | null
          created_by: string
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      payroll_entries: {
        Row: {
          id: string
          tenant_id: string
          payroll_period_id: string
          employee_id: string
          base_pay: number
          commission_total: number
          tips: number
          bonus: number
          cash_advance: number
          deductions: number
          adjustments: number
          withholding_tax: number
          sss_contribution: number
          philhealth_contribution: number
          pagibig_contribution: number
          sss_loan: number
          hdmf_loan: number
          net_pay: number
          created_at: string
        }
        Insert: never
        Update: {
          base_pay?: number
          tips?: number
          bonus?: number
          cash_advance?: number
          deductions?: number
          adjustments?: number
          withholding_tax?: number
          sss_contribution?: number
          philhealth_contribution?: number
          pagibig_contribution?: number
          sss_loan?: number
          hdmf_loan?: number
        }
        Relationships: []
      }
      payroll_adjustments: {
        Row: {
          id: string
          tenant_id: string
          payroll_entry_id: string
          amount: number
          reason: string
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          payroll_entry_id: string
          amount: number
          reason: string
          created_by: string
          created_at?: string
        }
        Update: never
        Relationships: []
      }
      cash_advances: {
        Row: {
          id: string
          tenant_id: string
          employee_id: string
          amount: number
          advance_date: string
          reason: string | null
          remaining_balance: number
          status: 'outstanding' | 'paid'
          created_by: string
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      cash_advance_repayments: {
        Row: {
          id: string
          tenant_id: string
          cash_advance_id: string
          payroll_entry_id: string
          amount: number
          created_by: string
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      payroll_deductions: {
        Row: {
          id: string
          tenant_id: string
          payroll_entry_id: string
          amount: number
          reason: string
          created_by: string
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      promotions: {
        Row: {
          id: string
          tenant_id: string
          name: string
          description: string | null
          discount_type: 'percentage' | 'fixed_amount'
          discount_value: number
          min_spend: number | null
          starts_at: string | null
          ends_at: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          description?: string | null
          discount_type: 'percentage' | 'fixed_amount'
          discount_value: number
          min_spend?: number | null
          starts_at?: string | null
          ends_at?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['promotions']['Insert']>
        Relationships: []
      }
      promotion_services: {
        Row: {
          promotion_id: string
          service_id: string
        }
        Insert: {
          promotion_id: string
          service_id: string
        }
        Update: never
        Relationships: []
      }
      loyalty_transactions: {
        Row: {
          id: string
          tenant_id: string
          customer_id: string
          transaction_type: 'earn' | 'redeem' | 'adjustment'
          points_delta: number
          sale_id: string | null
          reference_note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      fleet_accounts: {
        Row: {
          id: string
          tenant_id: string
          customer_id: string
          credit_limit: number | null
          payment_terms_days: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          customer_id: string
          credit_limit?: number | null
          payment_terms_days?: number
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['fleet_accounts']['Insert']>
        Relationships: []
      }
      membership_programs: {
        Row: {
          id: string
          tenant_id: string
          name: string
          description: string | null
          stamps_required: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          description?: string | null
          stamps_required: number
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['membership_programs']['Insert']>
        Relationships: []
      }
      membership_program_services: {
        Row: {
          program_id: string
          service_id: string
        }
        Insert: {
          program_id: string
          service_id: string
        }
        Update: never
        Relationships: []
      }
      membership_stamps: {
        Row: {
          id: string
          tenant_id: string
          customer_id: string
          program_id: string
          transaction_type: 'earn' | 'redeem' | 'adjustment'
          stamp_delta: number
          sale_id: string | null
          reference_note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      appointments: {
        Row: {
          id: string
          tenant_id: string
          location_id: string
          vehicle_id: string
          vehicle_size_id: string
          scheduled_at: string
          status: 'scheduled' | 'converted' | 'cancelled' | 'no_show'
          notes: string | null
          converted_job_id: string | null
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          location_id: string
          vehicle_id: string
          vehicle_size_id: string
          scheduled_at: string
          status?: 'scheduled' | 'converted' | 'cancelled' | 'no_show'
          notes?: string | null
          converted_job_id?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['appointments']['Insert']>
        Relationships: []
      }
      appointment_services: {
        Row: {
          id: string
          tenant_id: string
          appointment_id: string
          service_id: string
          quantity: number
        }
        Insert: {
          id?: string
          tenant_id: string
          appointment_id: string
          service_id: string
          quantity?: number
        }
        Update: never
        Relationships: []
      }
      vehicle_inspections: {
        Row: {
          id: string
          tenant_id: string
          job_id: string
          notes: string | null
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          job_id: string
          notes?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['vehicle_inspections']['Insert']>
        Relationships: []
      }
      vehicle_inspection_photos: {
        Row: {
          id: string
          tenant_id: string
          inspection_id: string
          storage_path: string
          caption: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          inspection_id: string
          storage_path: string
          caption?: string | null
          created_at?: string
        }
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
      job_board_entries: {
        Row: {
          id: string
          tenant_id: string
          client_generated_id: string
          job_number: string
          status: Database['public']['Tables']['jobs']['Row']['status']
          bay_id: string | null
          bay_name: string | null
          bay_entered_at: string | null
          created_at: string
          completed_at: string | null
          plate_number: string
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_size_name: string
          estimated_total: number
          services_summary: string | null
          attendants_summary: string | null
          is_paid: boolean
        }
        Relationships: []
      }
      inventory_stock_levels: {
        Row: {
          id: string
          tenant_id: string
          name: string
          sku: string | null
          item_type: 'retail' | 'consumable' | 'reusable_equipment' | 'asset'
          category_id: string | null
          unit_id: string
          unit_abbreviation: string
          retail_price: number | null
          min_stock: number | null
          reorder_level: number | null
          target_stock: number | null
          is_active: boolean
          on_hand_qty: number
          latest_unit_cost: number | null
          average_unit_cost: number | null
          inventory_value: number
          is_low_stock: boolean
        }
        Relationships: []
      }
      loyalty_balances: {
        Row: {
          tenant_id: string
          customer_id: string
          balance: number
        }
        Relationships: []
      }
      fleet_account_balances: {
        Row: {
          fleet_account_id: string
          tenant_id: string
          customer_id: string
          outstanding_balance: number
        }
        Relationships: []
      }
      membership_stamp_balances: {
        Row: {
          tenant_id: string
          customer_id: string
          program_id: string
          stamps: number
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
      complete_job: {
        Args: { p_job_id: string }
        Returns: Json
      }
      create_job: {
        Args: { payload: Json }
        Returns: Json
      }
      job_is_editable: {
        Args: { p_job_id: string; p_tenant_id: string }
        Returns: boolean
      }
      add_job_service: {
        Args: { p_job_id: string; p_service_id: string; p_quantity: number; p_manual_price: number | null }
        Returns: Json
      }
      remove_job_service: {
        Args: { p_job_service_id: string }
        Returns: Json
      }
      update_job_service_quantity: {
        Args: { p_job_service_id: string; p_quantity: number }
        Returns: Json
      }
      update_job_vehicle_size: {
        Args: { p_job_id: string; p_vehicle_size_id: string }
        Returns: Json
      }
      create_sale: {
        Args: { payload: Json }
        Returns: Json
      }
      adjust_loyalty_points: {
        Args: { p_customer_id: string; p_points_delta: number; p_reason: string }
        Returns: Json
      }
      record_fleet_settlement: {
        Args: { p_sale_id: string; p_method: string; p_amount: number; p_reference_note: string | null }
        Returns: Json
      }
      adjust_membership_stamps: {
        Args: { p_customer_id: string; p_program_id: string; p_stamp_delta: number; p_reason: string }
        Returns: Json
      }
      close_shift: {
        Args: { p_shift_id: string; p_counted_cash: number; p_variance_reason?: string }
        Returns: Json
      }
      current_employee_id: {
        Args: Record<string, never>
        Returns: string
      }
      generate_payroll_period: {
        Args: { p_period_type: string; p_start_date: string; p_end_date: string }
        Returns: Json
      }
      lock_payroll_period: {
        Args: { p_period_id: string }
        Returns: Json
      }
      mark_payroll_period_paid: {
        Args: { p_period_id: string }
        Returns: Json
      }
      delete_payroll_period: {
        Args: { p_period_id: string }
        Returns: Json
      }
      create_cash_advance: {
        Args: { p_employee_id: string; p_amount: number; p_advance_date: string; p_reason: string | null }
        Returns: Json
      }
      record_cash_advance_repayment: {
        Args: { p_cash_advance_id: string; p_payroll_entry_id: string; p_amount: number }
        Returns: Json
      }
      void_cash_advance_repayment: {
        Args: { p_repayment_id: string }
        Returns: Json
      }
      add_payroll_deduction: {
        Args: { p_payroll_entry_id: string; p_amount: number; p_reason: string }
        Returns: Json
      }
      remove_payroll_deduction: {
        Args: { p_deduction_id: string }
        Returns: Json
      }
      delete_employee: {
        Args: { p_employee_id: string }
        Returns: Json
      }
      delete_bay: {
        Args: { p_bay_id: string }
        Returns: Json
      }
      recompute_job_commission: {
        Args: { p_job_id: string }
        Returns: Json
      }
      adjust_inventory_stock: {
        Args: { p_item_id: string; p_transaction_type: string; p_quantity_delta: number; p_reason: string }
        Returns: Json
      }
      create_purchase_order: {
        Args: { payload: Json }
        Returns: Json
      }
      record_expense: {
        Args: { payload: Json }
        Returns: Json
      }
      void_expense: {
        Args: { p_expense_id: string; p_reason: string }
        Returns: undefined
      }
      void_sale: {
        Args: { p_sale_id: string; p_reason: string; p_reverse_commission?: boolean }
        Returns: Json
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

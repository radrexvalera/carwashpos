-- Convenience helper: resolves the calling user's own employee row within their tenant. Used by
-- shift ownership checks here and will be reused by the attendant dashboard (Phase 3) and anywhere
-- else "my own records" needs to be expressed in RLS/RPCs.
create function public.current_employee_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from public.employees where user_id = auth.uid() and tenant_id = public.current_tenant_id();
$$;

create table public.cashier_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  cashier_id uuid not null references public.employees(id),
  opened_at timestamptz not null default now(),
  opening_float numeric(12, 2) not null default 0 check (opening_float >= 0),
  closed_at timestamptz,
  expected_cash numeric(12, 2),
  counted_cash numeric(12, 2),
  variance numeric(12, 2),
  variance_reason text,
  status text not null default 'open' check (status in ('open', 'closed'))
);
create index cashier_shifts_tenant_id_idx on public.cashier_shifts(tenant_id);
create unique index cashier_shifts_one_open_per_cashier on public.cashier_shifts(cashier_id) where status = 'open';

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  shift_id uuid not null references public.cashier_shifts(id) on delete cascade,
  type text not null check (type in ('cash_in', 'cash_out')),
  amount numeric(12, 2) not null check (amount > 0),
  category text not null,
  reason text,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now()
);
create index cash_movements_tenant_id_idx on public.cash_movements(tenant_id);
create index cash_movements_shift_id_idx on public.cash_movements(shift_id);

alter table public.cashier_shifts enable row level security;

create policy cashier_shifts_select on public.cashier_shifts
  for select using (tenant_id = public.current_tenant_id());

create policy cashier_shifts_insert on public.cashier_shifts
  for insert with check (
    tenant_id = public.current_tenant_id()
    and public.has_permission('can_manage_shift')
    and cashier_id = public.current_employee_id()
  );
-- No update policy: closing a shift only happens through close_shift() (migration 0021), which
-- computes expected_cash from actual sales/cash-movement data rather than trusting a client value.

alter table public.cash_movements enable row level security;

create policy cash_movements_select on public.cash_movements
  for select using (tenant_id = public.current_tenant_id());

create policy cash_movements_insert on public.cash_movements
  for insert with check (
    tenant_id = public.current_tenant_id()
    and public.has_permission('can_manage_shift')
    and exists (
      select 1 from public.cashier_shifts cs
      where cs.id = cash_movements.shift_id and cs.status = 'open' and cs.cashier_id = public.current_employee_id()
    )
  );

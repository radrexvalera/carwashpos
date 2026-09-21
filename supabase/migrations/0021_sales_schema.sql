-- A sale is deliberately decoupled from a job's lifecycle (plan doc "Structural issues" #2): it
-- can be created whenever the business collects payment -- right after job creation, mid-service,
-- or after completion -- not gated by job status. At most one active (non-voided) sale per job for
-- v1 (partial payment across multiple sales isn't built yet; split payment = multiple payment
-- METHODS on one sale, which is supported).

create table public.tenant_sale_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sale_date date not null,
  next_number int not null default 1,
  primary key (tenant_id, sale_date)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  client_generated_id uuid not null unique,
  sale_number text not null,
  job_id uuid references public.jobs(id),
  shift_id uuid not null references public.cashier_shifts(id),
  subtotal numeric(12, 2) not null default 0,
  discount_total numeric(12, 2) not null default 0,
  tax_total numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  status text not null default 'completed' check (status in ('completed', 'voided', 'refunded')),
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  voided_by uuid references public.user_profiles(id),
  voided_at timestamptz,
  void_reason text,
  refunded_by uuid references public.user_profiles(id),
  refunded_at timestamptz,
  refund_reason text,
  unique (tenant_id, sale_number)
);
create index sales_tenant_id_idx on public.sales(tenant_id);
create index sales_shift_id_idx on public.sales(shift_id);
create unique index sales_one_active_per_job on public.sales(job_id) where status != 'voided' and job_id is not null;

create function public.prevent_sale_tampering()
returns trigger
language plpgsql
as $$
begin
  if new.sale_number is distinct from old.sale_number
    or new.subtotal is distinct from old.subtotal
    or new.discount_total is distinct from old.discount_total
    or new.tax_total is distinct from old.tax_total
    or new.total is distinct from old.total
    or new.tenant_id is distinct from old.tenant_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Sale financial/identity fields can only be set by create_job/create_sale flows';
  end if;
  return new;
end;
$$;

create trigger sales_prevent_tampering
  before update on public.sales
  for each row execute function public.prevent_sale_tampering();

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  line_type text not null check (line_type in ('job_service', 'product')),
  job_service_id uuid references public.job_services(id),
  product_id uuid references public.products(id),
  description text not null,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  discount_amount numeric(12, 2) not null default 0,
  line_total numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  check (
    (line_type = 'job_service' and job_service_id is not null and product_id is null)
    or
    (line_type = 'product' and product_id is not null and job_service_id is null)
  )
);
create index sale_items_tenant_id_idx on public.sale_items(tenant_id);
create index sale_items_sale_id_idx on public.sale_items(sale_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  method text not null check (method in ('cash', 'gcash', 'maya', 'bank_transfer', 'card')),
  amount numeric(12, 2) not null check (amount > 0),
  reference_note text,
  paid_at timestamptz not null default now(),
  recorded_by uuid not null references public.user_profiles(id)
);
create index payments_tenant_id_idx on public.payments(tenant_id);
create index payments_sale_id_idx on public.payments(sale_id);

alter table public.tenant_sale_counters enable row level security;
-- No policies: only create_sale() (security definer) touches this table.

alter table public.sales enable row level security;

create policy sales_select on public.sales
  for select using (tenant_id = public.current_tenant_id());

alter table public.sale_items enable row level security;

create policy sale_items_select on public.sale_items
  for select using (tenant_id = public.current_tenant_id());

alter table public.payments enable row level security;

create policy payments_select on public.payments
  for select using (tenant_id = public.current_tenant_id());

-- No insert/update policies on sales/sale_items/payments -- creation only through create_sale()
-- (next migration); voids/refunds will be their own gated RPCs (Phase 2 continued / Phase 8),
-- same "no direct client write" discipline as tickets and jobs.

-- Phase 1: the ticket -- the central transaction object every other module reads or writes.
-- Ticket creation, pricing, payment validation, and stock deduction all happen inside the
-- complete_ticket() RPC (0005), never via direct client INSERT -- see that file's header comment.

-- Per-tenant, gapless, server-assigned ticket numbers (e.g. "Ticket #1042" for that shop
-- specifically) -- never client-generated, which is what lets two offline cashiers both create a
-- ticket without colliding once they sync (see plan doc "Phase 1 -- POS / Checkout").
create table public.tenant_ticket_counters (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  next_number bigint not null default 1
);

-- Extend the Phase 0 tenant-seeding trigger to also seed a counter row for every new tenant, and
-- backfill one for tenants that already exist (just "WashWash" so far).
create or replace function public.seed_new_tenant_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.locations (tenant_id, name)
  values (new.id, 'Main Location');

  insert into public.vehicle_size_classes (tenant_id, name, sort_order)
  values
    (new.id, 'Sedan', 1),
    (new.id, 'SUV', 2),
    (new.id, 'Van/Pickup', 3);

  insert into public.tenant_ticket_counters (tenant_id, next_number)
  values (new.id, 1);

  return new;
end;
$$;

insert into public.tenant_ticket_counters (tenant_id, next_number)
select id, 1 from public.tenants
on conflict (tenant_id) do nothing;

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  -- Offline idempotency key: lets a retried sync-queue flush (e.g. after a dropped response) be a
  -- safe no-op re-fetch instead of creating a duplicate ticket. See complete_ticket().
  client_generated_id uuid not null unique,
  ticket_number bigint not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'in_bay', 'ready_for_pickup', 'picked_up_paid', 'voided')),
  bay_id uuid references public.bays(id),
  subtotal numeric(10, 2) not null default 0,
  discount_total numeric(10, 2) not null default 0,
  tax_total numeric(10, 2) not null default 0,
  total numeric(10, 2) not null default 0,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  voided_by uuid references public.user_profiles(id),
  voided_at timestamptz,
  void_reason text,
  unique (tenant_id, ticket_number)
);
create index tickets_tenant_id_idx on public.tickets(tenant_id);
create index tickets_status_idx on public.tickets(tenant_id, status);

-- Client-facing UPDATE (Phase 2's bay board moving a ticket through waiting/in_bay/etc) must never
-- be able to rewrite what was actually charged -- those fields are set once, by complete_ticket(),
-- at creation. Voiding (a future admin/manager-only function) is exempt since it legitimately sets
-- status/voided_*.
create function public.prevent_ticket_financial_tampering()
returns trigger
language plpgsql
as $$
begin
  if new.subtotal is distinct from old.subtotal
    or new.discount_total is distinct from old.discount_total
    or new.tax_total is distinct from old.tax_total
    or new.total is distinct from old.total
    or new.ticket_number is distinct from old.ticket_number
    or new.client_generated_id is distinct from old.client_generated_id
    or new.tenant_id is distinct from old.tenant_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Ticket financial/identity fields can only be set by complete_ticket()';
  end if;
  return new;
end;
$$;

create trigger tickets_prevent_financial_tampering
  before update on public.tickets
  for each row execute function public.prevent_ticket_financial_tampering();

create table public.ticket_line_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  line_type text not null check (line_type in ('service', 'product')),
  service_id uuid references public.services(id),
  vehicle_size_class_id uuid references public.vehicle_size_classes(id),
  product_id uuid references public.products(id),
  -- Frozen at sale time -- immune to a later catalog price edit changing what a past ticket reads
  -- as having charged.
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  discount_amount numeric(10, 2) not null default 0,
  line_total numeric(10, 2) not null,
  created_at timestamptz not null default now(),
  check (
    (line_type = 'service' and service_id is not null and vehicle_size_class_id is not null and product_id is null)
    or
    (line_type = 'product' and product_id is not null and service_id is null and vehicle_size_class_id is null)
  )
);
create index ticket_line_items_tenant_id_idx on public.ticket_line_items(tenant_id);
create index ticket_line_items_ticket_id_idx on public.ticket_line_items(ticket_id);

create table public.ticket_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  method text not null check (method in ('cash', 'e_wallet', 'card')),
  amount numeric(10, 2) not null check (amount > 0),
  reference_note text,
  paid_at timestamptz not null default now(),
  recorded_by uuid not null references public.user_profiles(id)
);
create index ticket_payments_tenant_id_idx on public.ticket_payments(tenant_id);
create index ticket_payments_ticket_id_idx on public.ticket_payments(ticket_id);

-- Staff-applied promotions (percentage or fixed-peso off), optionally restricted to specific
-- services and/or a date range and/or a minimum spend. No customer-facing codes -- the cashier
-- picks one from a list at checkout. Discount is computed server-side inside create_sale(),
-- never trusted from the client.

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  discount_type text not null check (discount_type in ('percentage', 'fixed_amount')),
  discount_value numeric(12, 2) not null check (discount_value > 0),
  min_spend numeric(12, 2) check (min_spend is null or min_spend >= 0),
  starts_at date,
  ends_at date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index promotions_tenant_id_idx on public.promotions(tenant_id);

-- Empty = applies to any service line on the sale. Non-empty = only these services are
-- eligible for this promotion's discount (e.g. "20% off Interior Detailing this month").
create table public.promotion_services (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (promotion_id, service_id)
);

alter table public.promotions enable row level security;
create policy promotions_select on public.promotions
  for select using (tenant_id = public.current_tenant_id());
create policy promotions_insert on public.promotions
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_promotions'));
create policy promotions_update on public.promotions
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_promotions'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_promotions'));

alter table public.promotion_services enable row level security;
create policy promotion_services_select on public.promotion_services
  for select using (
    exists (select 1 from public.promotions p where p.id = promotion_id and p.tenant_id = public.current_tenant_id())
  );
create policy promotion_services_insert on public.promotion_services
  for insert with check (
    public.has_permission('can_manage_promotions')
    and exists (select 1 from public.promotions p where p.id = promotion_id and p.tenant_id = public.current_tenant_id())
  );
create policy promotion_services_delete on public.promotion_services
  for delete using (
    public.has_permission('can_manage_promotions')
    and exists (select 1 from public.promotions p where p.id = promotion_id and p.tenant_id = public.current_tenant_id())
  );

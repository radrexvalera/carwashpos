-- Stamp card programs: "buy N, get one free" -- the actual program this business already runs,
-- fully customizable (which service(s) count, how many stamps). A different reward shape than
-- loyalty (peso-value points earned per amount spent): one stamp per qualifying VISIT regardless
-- of price, redeemed for one specific service made free, not a peso discount. Kept as its own
-- ledger rather than folded into loyalty_transactions since a shop can run both simultaneously.
create table public.membership_programs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  stamps_required int not null check (stamps_required > 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index membership_programs_tenant_id_idx on public.membership_programs(tenant_id);

-- Not optional like promotion_services -- a stamp card with no defined service is meaningless.
-- Enforced in the earn/redeem RPCs (an empty program just never earns/redeems), no DB constraint
-- for "at least one row" exists elsewhere in this schema either.
create table public.membership_program_services (
  program_id uuid not null references public.membership_programs(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (program_id, service_id)
);

alter table public.membership_programs enable row level security;
create policy membership_programs_select on public.membership_programs
  for select using (tenant_id = public.current_tenant_id());
create policy membership_programs_insert on public.membership_programs
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_promotions'));
create policy membership_programs_update on public.membership_programs
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_promotions'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_promotions'));

alter table public.membership_program_services enable row level security;
create policy membership_program_services_select on public.membership_program_services
  for select using (
    exists (select 1 from public.membership_programs p where p.id = program_id and p.tenant_id = public.current_tenant_id())
  );
create policy membership_program_services_insert on public.membership_program_services
  for insert with check (
    public.has_permission('can_manage_promotions')
    and exists (select 1 from public.membership_programs p where p.id = program_id and p.tenant_id = public.current_tenant_id())
  );
create policy membership_program_services_delete on public.membership_program_services
  for delete using (
    public.has_permission('can_manage_promotions')
    and exists (select 1 from public.membership_programs p where p.id = program_id and p.tenant_id = public.current_tenant_id())
  );

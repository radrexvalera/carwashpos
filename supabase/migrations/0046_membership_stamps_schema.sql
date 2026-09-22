-- Append-only stamp ledger, same discipline as loyalty_transactions/inventory_transactions --
-- balance is always a derived sum via the view below, never a stored counter that could drift.
-- No enrollment table: participation is implicit, exactly like loyalty -- any customer whose job
-- includes a program's eligible service earns a stamp, no signup step.
create table public.membership_stamps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  program_id uuid not null references public.membership_programs(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('earn', 'redeem', 'adjustment')),
  stamp_delta int not null,
  sale_id uuid references public.sales(id),
  reference_note text,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now()
);
create index membership_stamps_tenant_id_idx on public.membership_stamps(tenant_id);
create index membership_stamps_customer_program_idx on public.membership_stamps(customer_id, program_id);

create view public.membership_stamp_balances
with (security_invoker = true) as
select tenant_id, customer_id, program_id, sum(stamp_delta)::int as stamps
from public.membership_stamps
group by tenant_id, customer_id, program_id;
grant select on public.membership_stamp_balances to authenticated;

alter table public.membership_stamps enable row level security;
create policy membership_stamps_select on public.membership_stamps
  for select using (tenant_id = public.current_tenant_id());
-- No insert/update policy: only create_sale()/record_fleet_settlement()/adjust_membership_stamps()
-- (next migration) write these.

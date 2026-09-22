-- Points-based loyalty: append-only ledger, balance is always a derived sum (same discipline as
-- inventory_transactions/commission_ledger) -- never a stored running total that could drift.
-- Only registered customers can earn/redeem (a pure walk-in with no customer_id can't).

create table public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('earn', 'redeem', 'adjustment')),
  points_delta int not null,
  sale_id uuid references public.sales(id),
  reference_note text,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now()
);
create index loyalty_transactions_tenant_id_idx on public.loyalty_transactions(tenant_id);
create index loyalty_transactions_customer_id_idx on public.loyalty_transactions(customer_id);

create view public.loyalty_balances
with (security_invoker = true) as
select tenant_id, customer_id, sum(points_delta)::int as balance
from public.loyalty_transactions
group by tenant_id, customer_id;
grant select on public.loyalty_balances to authenticated;

-- Owner-tunable via Settings -- these are a starting-guess default (₱1 spent = 1 point,
-- 2 points = ₱1 off), review and adjust for actual margins, same as the Phase 1 price remap.
alter table public.settings
  add column loyalty_earn_rate numeric(6, 4) not null default 1,
  add column loyalty_redemption_value numeric(6, 4) not null default 0.5;

alter table public.loyalty_transactions enable row level security;
create policy loyalty_transactions_select on public.loyalty_transactions
  for select using (tenant_id = public.current_tenant_id());
-- No insert/update policy: only create_sale()/adjust_loyalty_points() (next migration) write these.

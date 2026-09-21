-- Operating expense tracking (rent, utilities, salaries, supplies, maintenance, marketing, etc.).
-- Deliberately standalone from cash_movements/shift reconciliation for v1: most operating expenses
-- aren't paid out of the till by the shift cashier (rent/utilities are typically bank transfer,
-- paid by the owner directly) -- revisit only if the business specifically wants till-paid
-- expenses reflected in shift cash-counting.

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index expense_categories_tenant_id_idx on public.expense_categories(tenant_id);

-- A financial record, like sales/purchase_orders: no direct insert/update policy, only
-- record_expense()/void_expense() (next migration) write these. Never deleted or edited after the
-- fact -- a correction is a void with a required reason, never a row edit or hard delete, matching
-- every other ledger in this app.
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid not null references public.expense_categories(id),
  description text not null,
  amount numeric(12, 2) not null check (amount > 0),
  expense_date date not null default current_date,
  payment_method text not null check (payment_method in ('cash', 'gcash', 'maya', 'bank_transfer', 'card')),
  paid_to text,
  reference_note text,
  is_voided boolean not null default false,
  voided_by uuid references public.user_profiles(id),
  voided_at timestamptz,
  void_reason text,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now()
);
create index expenses_tenant_id_idx on public.expenses(tenant_id);
create index expenses_expense_date_idx on public.expenses(expense_date);

create function public.prevent_expense_tampering()
returns trigger
language plpgsql
as $$
begin
  if new.category_id is distinct from old.category_id
    or new.description is distinct from old.description
    or new.amount is distinct from old.amount
    or new.expense_date is distinct from old.expense_date
    or new.payment_method is distinct from old.payment_method
    or new.tenant_id is distinct from old.tenant_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Expense financial/identity fields can only be set by record_expense(); use void_expense() to correct a mistake';
  end if;
  return new;
end;
$$;

create trigger expenses_prevent_tampering
  before update on public.expenses
  for each row execute function public.prevent_expense_tampering();

alter table public.expense_categories enable row level security;
create policy expense_categories_select on public.expense_categories
  for select using (tenant_id = public.current_tenant_id());
create policy expense_categories_insert on public.expense_categories
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_expenses'));
create policy expense_categories_update on public.expense_categories
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_expenses'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_expenses'));

alter table public.expenses enable row level security;
create policy expenses_select on public.expenses
  for select using (tenant_id = public.current_tenant_id());
-- No insert/update policy: only record_expense()/void_expense() (next migration) write these.

insert into public.expense_categories (tenant_id, name, sort_order) values
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Rent', 1),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Utilities', 2),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Salaries & Wages', 3),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Supplies', 4),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Equipment & Maintenance', 5),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Marketing', 6),
  ('a15d3963-6a8b-433c-8c21-407915ea1437', 'Miscellaneous', 7);

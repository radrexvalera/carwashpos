-- Employee registry, separate from user_profiles (auth-linked login accounts). Many attendants are
-- tracked here purely for commission/scheduling purposes and never log into the system at all --
-- user_id is nullable for exactly that reason. Staff who DO need login (cashier, supervisor,
-- manager, admin) get a linked user_profiles row.
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references public.user_profiles(id),
  employee_code text,
  full_name text not null,
  nickname text,
  mobile text,
  hire_date date,
  employment_status text not null default 'active' check (employment_status in ('active', 'inactive', 'terminated')),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);
create index employees_tenant_id_idx on public.employees(tenant_id);
create unique index employees_tenant_user_key on public.employees(tenant_id, user_id) where user_id is not null;
create unique index employees_tenant_code_key on public.employees(tenant_id, employee_code) where employee_code is not null;

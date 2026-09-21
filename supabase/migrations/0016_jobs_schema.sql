-- The job is the shop-floor unit of work -- created independent of payment (see plan doc
-- "Structural issues" #2: sales are decoupled from jobs entirely, so there's no pay-before/
-- pay-after mode toggle). Attendants are assigned per SERVICE LINE (job_service_attendants), not
-- per job, so different crew can work different services on the same vehicle.

alter table public.bays rename to wash_bays;
alter index bays_pkey rename to wash_bays_pkey;
alter index bays_tenant_id_idx rename to wash_bays_tenant_id_idx;

-- Per-tenant, per-day job numbering (e.g. JOB-20260921-0154) -- server-assigned inside
-- create_job(), never client-generated, same rationale as the old tenant_ticket_counters.
create table public.tenant_job_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_date date not null,
  next_number int not null default 1,
  primary key (tenant_id, job_date)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  client_generated_id uuid not null unique,
  job_number text not null,
  vehicle_id uuid not null references public.vehicles(id),
  vehicle_size_id uuid not null references public.vehicle_sizes(id),
  bay_id uuid references public.wash_bays(id),
  status text not null default 'waiting'
    check (status in ('waiting', 'washing', 'detailing', 'quality_check', 'ready_for_release', 'completed', 'cancelled')),
  bay_entered_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, job_number)
);
create index jobs_tenant_id_idx on public.jobs(tenant_id);
create index jobs_status_idx on public.jobs(tenant_id, status);
create index jobs_vehicle_id_idx on public.jobs(vehicle_id);

-- Same financial/identity-tampering guard pattern as tickets: direct client UPDATE (used for
-- status/bay transitions on the queue board) can never rewrite what a job actually is.
create function public.prevent_job_tampering()
returns trigger
language plpgsql
as $$
begin
  if new.job_number is distinct from old.job_number
    or new.vehicle_id is distinct from old.vehicle_id
    or new.tenant_id is distinct from old.tenant_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Job identity fields can only be set at creation';
  end if;
  return new;
end;
$$;

create trigger jobs_prevent_tampering
  before update on public.jobs
  for each row execute function public.prevent_job_tampering();

-- One row per service on the ticket. line_total/unit_price are frozen at job creation (from
-- service_prices for pricing_type='matrix', or services.flat_price otherwise) -- immune to a
-- later catalog price edit. status is tracked per-line (not just per-job) because commission
-- (Phase 3) and inventory recipe deduction (Phase 4) both fire when a SERVICE, not the whole job,
-- completes -- a job can have some services done and others still in progress.
create table public.job_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  service_id uuid not null references public.services(id),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  line_total numeric(12, 2) not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index job_services_tenant_id_idx on public.job_services(tenant_id);
create index job_services_job_id_idx on public.job_services(job_id);

create table public.job_service_attendants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_service_id uuid not null references public.job_services(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  role_in_job text,
  split_percentage numeric(5, 2) check (split_percentage is null or (split_percentage > 0 and split_percentage <= 100)),
  created_at timestamptz not null default now(),
  unique (job_service_id, employee_id)
);
create index job_service_attendants_tenant_id_idx on public.job_service_attendants(tenant_id);
create index job_service_attendants_employee_id_idx on public.job_service_attendants(employee_id);

create table public.job_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid not null references public.user_profiles(id),
  changed_at timestamptz not null default now(),
  note text
);
create index job_status_history_job_id_idx on public.job_status_history(job_id);

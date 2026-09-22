-- A booking made ahead of time, "checked in" later into a real job via the existing
-- create_job() RPC (not duplicated here). Always references a real vehicle_id, same as jobs --
-- if a customer books for a car not yet in the system, staff resolve/create that vehicle first
-- via the same flow RegisterPage already uses, then book the appointment against it.
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id),
  vehicle_size_id uuid not null references public.vehicle_sizes(id),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'converted', 'cancelled', 'no_show')),
  notes text,
  converted_job_id uuid references public.jobs(id),
  -- Defaulted (not set explicitly by the client) -- unlike sales/jobs, appointments are written
  -- via a plain client insert, not a SECURITY DEFINER RPC, so there's no server-side auth.uid()
  -- available except through this column default.
  created_by uuid not null references public.user_profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index appointments_tenant_id_idx on public.appointments(tenant_id);
create index appointments_scheduled_at_idx on public.appointments(tenant_id, scheduled_at);

-- No frozen price here (unlike job_services) -- a request, not a commitment. Pricing is computed
-- for real by create_job() at check-in time, same as it always is.
create table public.appointment_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_id uuid not null references public.services(id),
  quantity numeric(10, 2) not null default 1 check (quantity > 0)
);
create index appointment_services_appointment_id_idx on public.appointment_services(appointment_id);

-- Reuses can_manage_jobs -- appointments are pre-jobs, anyone who can create/manage a job today
-- should be able to manage bookings too. No tamper-guard trigger: status/converted_job_id are
-- meant to change freely after creation via plain RLS-gated updates (same as job status changes
-- already work), there's no frozen financial data on this table.
alter table public.appointments enable row level security;
create policy appointments_select on public.appointments
  for select using (tenant_id = public.current_tenant_id());
create policy appointments_insert on public.appointments
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs'));
create policy appointments_update on public.appointments
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs'));

alter table public.appointment_services enable row level security;
create policy appointment_services_select on public.appointment_services
  for select using (
    exists (select 1 from public.appointments a where a.id = appointment_id and a.tenant_id = public.current_tenant_id())
  );
create policy appointment_services_insert on public.appointment_services
  for insert with check (
    public.has_permission('can_manage_jobs')
    and exists (select 1 from public.appointments a where a.id = appointment_id and a.tenant_id = public.current_tenant_id())
  );
create policy appointment_services_delete on public.appointment_services
  for delete using (
    public.has_permission('can_manage_jobs')
    and exists (select 1 from public.appointments a where a.id = appointment_id and a.tenant_id = public.current_tenant_id())
  );

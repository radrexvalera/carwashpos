-- jobs/job_services are created only through create_job() (SECURITY DEFINER, migration 0018) --
-- same "no direct client INSERT" discipline as the old complete_ticket(). Direct UPDATE is allowed
-- (gated by can_manage_jobs) for the queue-board status/bay transitions and per-service status
-- changes; the tampering trigger keeps it from rewriting job identity.

alter table public.tenant_job_counters enable row level security;
-- No policies: only create_job() (security definer) touches this table.

alter table public.wash_bays enable row level security;
-- Policies already exist from migration 0002 under the old table name (bays_select/_insert/
-- _update) -- ALTER TABLE RENAME keeps them attached, still enforcing tenant_id + admin/manager
-- current_role() checks. Left as-is per the plan's "don't touch what isn't being reworked" rule.

alter table public.jobs enable row level security;

create policy jobs_select on public.jobs
  for select using (tenant_id = public.current_tenant_id());

create policy jobs_update on public.jobs
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs'));

alter table public.job_services enable row level security;

create policy job_services_select on public.job_services
  for select using (tenant_id = public.current_tenant_id());

create policy job_services_update on public.job_services
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs'));

alter table public.job_service_attendants enable row level security;

create policy job_service_attendants_select on public.job_service_attendants
  for select using (tenant_id = public.current_tenant_id());

create policy job_service_attendants_insert on public.job_service_attendants
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs'));

create policy job_service_attendants_delete on public.job_service_attendants
  for delete using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs'));

alter table public.job_status_history enable row level security;

create policy job_status_history_select on public.job_status_history
  for select using (tenant_id = public.current_tenant_id());

create policy job_status_history_insert on public.job_status_history
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs'));

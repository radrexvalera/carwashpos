-- Pre-service condition documentation: photos + notes taken at intake, before work starts,
-- protecting the shop from "you damaged my car" disputes. One inspection per job (intake only --
-- not a pickup/quality checklist). Same "plain client insert, no RPC" shape as appointments
-- (Phase 6d) -- there's no financial ledger here, RLS is the real gate.
create table public.vehicle_inspections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  notes text,
  created_by uuid not null references public.user_profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (job_id)
);
create index vehicle_inspections_tenant_id_idx on public.vehicle_inspections(tenant_id);

create table public.vehicle_inspection_photos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  inspection_id uuid not null references public.vehicle_inspections(id) on delete cascade,
  storage_path text not null,
  caption text,
  created_at timestamptz not null default now()
);
create index vehicle_inspection_photos_inspection_id_idx on public.vehicle_inspection_photos(inspection_id);

alter table public.vehicle_inspections enable row level security;
create policy vehicle_inspections_select on public.vehicle_inspections
  for select using (tenant_id = public.current_tenant_id());
create policy vehicle_inspections_insert on public.vehicle_inspections
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs'));
create policy vehicle_inspections_update on public.vehicle_inspections
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs'));

alter table public.vehicle_inspection_photos enable row level security;
create policy vehicle_inspection_photos_select on public.vehicle_inspection_photos
  for select using (tenant_id = public.current_tenant_id());
create policy vehicle_inspection_photos_insert on public.vehicle_inspection_photos
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_jobs'));

-- First Supabase Storage usage anywhere in this repo. A bucket is just a row in storage.buckets,
-- provisioned via migration like everything else here -- no dashboard step. Private (not public):
-- customer vehicle photos are tenant-scoped, sensitive data, served via signed URLs on demand.
-- Photos live at "{tenant_id}/{job_id}/{uuid}-{filename}" -- storage.foldername(name)[1] is the
-- tenant_id path segment, so the policy below is the exact same tenant-scoping shape as every
-- other table's select policy, just against storage.objects instead of a public.* table.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-inspection-photos', 'vehicle-inspection-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']);

create policy vehicle_inspection_photos_storage_select on storage.objects
  for select using (
    bucket_id = 'vehicle-inspection-photos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );
create policy vehicle_inspection_photos_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'vehicle-inspection-photos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.has_permission('can_manage_jobs')
  );

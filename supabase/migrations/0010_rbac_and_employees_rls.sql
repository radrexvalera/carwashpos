-- employees: read for all tenant members (needed for job/commission screens later to show who's
-- who); write restricted to whoever can manage employees. Uses the NEW has_permission() mechanism
-- rather than current_role(), establishing the pattern for everything built from here on.
alter table public.employees enable row level security;

create policy employees_select on public.employees
  for select using (tenant_id = public.current_tenant_id());

create policy employees_insert on public.employees
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_employees'));

create policy employees_update on public.employees
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_employees'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_employees'));

-- permissions: the global catalog is readable by any authenticated user (needed to render a role
-- editor's checkbox list) and never writable by clients -- it only changes via migrations as the
-- app gains features.
alter table public.permissions enable row level security;

create policy permissions_select on public.permissions
  for select using (true);

-- roles / role_permissions: read for all tenant members (needed to show "who has this role" and
-- to populate assignment dropdowns), write restricted to can_manage_roles.
alter table public.roles enable row level security;

create policy roles_select on public.roles
  for select using (tenant_id = public.current_tenant_id());

create policy roles_insert on public.roles
  for insert with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_roles'));

create policy roles_update on public.roles
  for update using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_roles'))
  with check (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_roles'));

alter table public.role_permissions enable row level security;

create policy role_permissions_select on public.role_permissions
  for select using (
    exists (select 1 from public.roles r where r.id = role_permissions.role_id and r.tenant_id = public.current_tenant_id())
  );

create policy role_permissions_insert on public.role_permissions
  for insert with check (
    public.has_permission('can_manage_roles')
    and exists (select 1 from public.roles r where r.id = role_permissions.role_id and r.tenant_id = public.current_tenant_id())
  );

create policy role_permissions_delete on public.role_permissions
  for delete using (
    public.has_permission('can_manage_roles')
    and exists (select 1 from public.roles r where r.id = role_permissions.role_id and r.tenant_id = public.current_tenant_id())
  );

alter table public.employee_roles enable row level security;

create policy employee_roles_select on public.employee_roles
  for select using (
    exists (select 1 from public.employees e where e.id = employee_roles.employee_id and e.tenant_id = public.current_tenant_id())
  );

create policy employee_roles_insert on public.employee_roles
  for insert with check (
    public.has_permission('can_manage_employees')
    and exists (select 1 from public.employees e where e.id = employee_roles.employee_id and e.tenant_id = public.current_tenant_id())
  );

create policy employee_roles_delete on public.employee_roles
  for delete using (
    public.has_permission('can_manage_employees')
    and exists (select 1 from public.employees e where e.id = employee_roles.employee_id and e.tenant_id = public.current_tenant_id())
  );

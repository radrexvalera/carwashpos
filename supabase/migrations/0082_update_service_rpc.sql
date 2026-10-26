-- updateService() went through a raw RLS-gated table update with no verification that it actually
-- matched anything -- an UPDATE whose RLS USING clause doesn't match (wrong tenant, missing
-- can_manage_catalog permission, row already gone) returns success with zero rows changed and NO
-- error at all, same silent-no-op class of bug this codebase has hit before. Converting to a
-- dedicated RPC, same treatment as delete_service(): explicit permission + existence checks that
-- actually raise instead of silently doing nothing.
create or replace function public.update_service(
  p_service_id uuid, p_name text, p_category_id uuid, p_pricing_type text, p_flat_price numeric,
  p_default_duration_minutes int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_catalog') then
    raise exception 'Not authorized to edit services';
  end if;

  if not exists (select 1 from public.services where id = p_service_id and tenant_id = v_tenant_id) then
    raise exception 'Service not found';
  end if;

  if p_name is null or trim(p_name) = '' then
    raise exception 'Name is required';
  end if;

  if p_pricing_type not in ('matrix', 'flat', 'starting_at', 'quoted') then
    raise exception 'Unknown pricing_type %', p_pricing_type;
  end if;

  if p_category_id is not null and not exists (
    select 1 from public.service_categories where id = p_category_id and tenant_id = v_tenant_id
  ) then
    raise exception 'Category not found';
  end if;

  update public.services
  set name = trim(p_name), category_id = p_category_id, pricing_type = p_pricing_type,
      flat_price = p_flat_price, default_duration_minutes = p_default_duration_minutes
  where id = p_service_id and tenant_id = v_tenant_id;

  return jsonb_build_object('id', p_service_id);
end;
$$;

grant execute on function public.update_service(uuid, text, uuid, text, numeric, int) to authenticated;

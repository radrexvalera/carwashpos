-- Services had no delete at all -- not even an RLS policy (a raw delete would've silently affected
-- 0 rows). A dedicated RPC rather than a plain RLS-gated delete, same as delete_bay(): job_services/
-- commission_ledger/appointment_services reference services with NO ACTION on delete, so a service
-- that's ever actually been used in a job raises a raw foreign-key error -- caught here and turned
-- into a friendly message instead, pointing at the existing inactive toggle as the real fix for
-- "retire a service that's already been used."
create or replace function public.delete_service(p_service_id uuid)
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
    raise exception 'Not authorized to delete services';
  end if;

  if not exists (select 1 from public.services where id = p_service_id and tenant_id = v_tenant_id) then
    raise exception 'Service not found';
  end if;

  begin
    delete from public.services where id = p_service_id and tenant_id = v_tenant_id;
  exception when foreign_key_violation then
    raise exception 'This service has been used in jobs and can''t be deleted -- set it inactive instead.';
  end;

  return jsonb_build_object('id', p_service_id, 'deleted', true);
end;
$$;

grant execute on function public.delete_service(uuid) to authenticated;

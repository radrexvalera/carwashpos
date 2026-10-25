-- Lets staff cancel a still-open, not-yet-paid job when a customer backs out (e.g. a long wait).
-- Same job_is_editable() gate as the other job corrections (0070): blocked once the job is already
-- completed/cancelled, or a non-voided sale exists against it -- that case needs a void instead, so
-- the sale and what it was billed for stay in agreement. 'cancelled' has been a legal jobs.status
-- value since 0016 and job_board_entries already excludes it (0070), so this is just the first thing
-- to actually set it. Also cancels any still-open job_services lines (nothing left dangling as
-- pending/in_progress under a cancelled job) and frees the bay.
create or replace function public.cancel_job(p_job_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_reason text := trim(coalesce(p_reason, ''));
  v_job record;
begin
  if v_tenant_id is null then
    raise exception 'No active tenant for the current user';
  end if;

  if not public.has_permission('can_manage_jobs') then
    raise exception 'Not authorized to cancel jobs';
  end if;

  if v_reason = '' then
    raise exception 'A cancellation reason is required';
  end if;

  select * into v_job from public.jobs where id = p_job_id and tenant_id = v_tenant_id;
  if v_job.id is null then
    raise exception 'Job not found';
  end if;

  if not public.job_is_editable(p_job_id, v_tenant_id) then
    raise exception 'This job can no longer be cancelled -- it is completed, cancelled, or already paid for';
  end if;

  update public.jobs set status = 'cancelled', bay_id = null, bay_entered_at = null where id = p_job_id;

  update public.job_services set status = 'cancelled' where job_id = p_job_id and status not in ('completed', 'cancelled');

  insert into public.job_status_history (tenant_id, job_id, from_status, to_status, changed_by, changed_at, note)
  values (v_tenant_id, p_job_id, v_job.status, 'cancelled', auth.uid(), now(), v_reason);

  return jsonb_build_object('id', p_job_id, 'status', 'cancelled');
end;
$$;

grant execute on function public.cancel_job(uuid, text) to authenticated;

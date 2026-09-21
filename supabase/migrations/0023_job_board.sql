-- Read-model for the job queue board, same pattern as ticket_board_entries: one row per
-- non-cancelled job with vehicle/bay/summary/attendant info, so the board doesn't need a separate
-- query per job. security_invoker inherits RLS from the underlying tables.
create view public.job_board_entries
with (security_invoker = true) as
select
  j.id,
  j.tenant_id,
  j.client_generated_id,
  j.job_number,
  j.status,
  j.bay_id,
  b.name as bay_name,
  j.bay_entered_at,
  j.created_at,
  j.completed_at,
  v.plate_number,
  v.make as vehicle_make,
  v.model as vehicle_model,
  vs.name as vehicle_size_name,
  (
    select coalesce(sum(js.line_total), 0)
    from public.job_services js
    where js.job_id = j.id and js.status != 'cancelled'
  ) as estimated_total,
  (
    select string_agg(
      s.name || case when js.quantity > 1 then ' x' || js.quantity::text else '' end,
      ', ' order by js.created_at
    )
    from public.job_services js
    join public.services s on s.id = js.service_id
    where js.job_id = j.id and js.status != 'cancelled'
  ) as services_summary,
  (
    select string_agg(distinct e.full_name, ', ')
    from public.job_service_attendants jsa
    join public.job_services js on js.id = jsa.job_service_id
    join public.employees e on e.id = jsa.employee_id
    where js.job_id = j.id
  ) as attendants_summary,
  exists (
    select 1 from public.sales s where s.job_id = j.id and s.status != 'voided'
  ) as is_paid
from public.jobs j
join public.vehicles v on v.id = j.vehicle_id
join public.vehicle_sizes vs on vs.id = j.vehicle_size_id
left join public.wash_bays b on b.id = j.bay_id
where j.status != 'cancelled';

grant select on public.job_board_entries to authenticated;

alter publication supabase_realtime add table public.jobs;

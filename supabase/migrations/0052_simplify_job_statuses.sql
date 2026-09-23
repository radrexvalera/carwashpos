-- Collapse washing/detailing/quality_check into a single 'ongoing' status.
-- No RPC references these intermediate literals (complete_job() only checks/sets 'completed'),
-- and job_status_history has no check constraint, so this is purely a jobs.status vocabulary change.

alter table public.jobs drop constraint if exists jobs_status_check;

update public.jobs set status = 'ongoing' where status in ('washing', 'detailing', 'quality_check');

alter table public.jobs add constraint jobs_status_check
  check (status in ('waiting', 'ongoing', 'ready_for_release', 'completed', 'cancelled'));

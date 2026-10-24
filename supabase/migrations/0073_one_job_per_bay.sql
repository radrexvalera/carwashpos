-- Server-side backstop for "a bay only ever holds one job at a time" -- the Job Queue UI already
-- hides an occupied bay from the picker, but that's a client-side read of a cache that's at most
-- ~20s fresh (board poll interval) or waiting on a Realtime round-trip, so two devices racing to
-- grab the same bay within that window could otherwise both succeed. jobs.bay_id is only ever
-- non-null while a job is 'ongoing' (advance() clears it the moment a job moves to
-- ready_for_release), so a plain partial unique index is all this needs -- no trigger required.
-- A losing write surfaces through the normal offline-mutation-queue failure path (sync issues
-- badge) the same way any other rejected mutation already does.
create unique index jobs_one_active_job_per_bay on public.jobs (tenant_id, bay_id) where bay_id is not null;

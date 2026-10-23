-- Tracks whether a tenant has seen the guided setup tour, so it only auto-launches once (on
-- first login after signup) and can still be replayed on demand afterward without re-triggering
-- automatically. Tenant-wide rather than per-user since onboarding is normally a one-time,
-- owner-driven setup pass, not something tracked separately per staff login.
alter table public.settings add column onboarding_completed_at timestamptz;

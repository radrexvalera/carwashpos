# OtoKwikk Car Wash Management System

A production-track Philippine car wash management system: POS, job queue, attendant commission/payroll, inventory, expenses, and owner reporting, built offline-first for spotty shop connectivity.

This README reflects what's actually implemented. See `CHANGELOG.md` for phase-by-phase history.

## Project overview

Built for a single-branch Philippine car wash (OtoKwikk / tenant "WashWash"), architected so a second branch or a second business can be added later without a schema rewrite — every table carries `tenant_id` (the business) and, where relevant, `location_id` (the branch).

**Status**: Phases 1–3 of the new 8-phase roadmap are complete. Phase 1: multi-tenant RBAC, employee registry, vehicle-size/service-catalog taxonomy, business settings. Phase 2: the real job-based POS — Register (create a job), Job Queue (Kanban board), Collect Payment, and cashier shift management. Phase 3: commission rules, an append-only commission ledger computed when a job completes, an attendant "My Commission" dashboard, and a manager-facing commission report. The earlier, simpler ticket-based POS + bay board built before the roadmap pivot has been fully retired (deleted from the app; its database tables remain in Postgres, unused).

## Architecture

- **Frontend**: React + TypeScript + Vite, Tailwind CSS v4, shadcn/ui (New York style), lucide-react icons, react-hook-form + zod for forms.
- **Backend**: Supabase — Postgres, Auth, Row-Level Security, Realtime. All business logic that must be atomic (pricing, stock/commission deltas, idempotent creation) lives in Postgres functions, never computed authoritatively on the client.
- **Offline**: Dexie.js (IndexedDB) as a local read-cache for catalog data and an outbox (`mutation_queue`) for writes made while offline, synced via a background flush loop once reconnected. Client-generated UUIDs make retried syncs idempotent.
- **Multi-tenant**: one Supabase project serves multiple businesses; every table is tenant-scoped via RLS policies checking `tenant_id = current_tenant_id()`.
- **RBAC**: two layers exist today — a legacy `user_profiles.role` enum (admin/manager/cashier) that still drives some Phase 0 catalog tables' RLS, and the capability-based system (`roles`/`permissions`/`role_permissions`/`employee_roles`, checked via `has_permission('some_capability')`) that everything from Phase 1 onward uses, including all of Phase 2's jobs/sales/shifts.
- **Jobs vs. sales are decoupled**: a job (the shop-floor unit of work) is created independent of payment; a sale can reference a job at any point in its lifecycle, or not at all (a pure retail sale). This avoids a pay-before/pay-after mode toggle — the cashier just chooses when to collect payment.

## Local development

```bash
npm install
cp .env.example .env   # fill in your Supabase project URL + anon key
npm run dev
```

Requires Node 20+.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Install the Supabase CLI and link it: `supabase login`, then `supabase link --project-ref <your-project-ref>`.
3. Apply migrations: `supabase db push`.
4. Provision the first tenant + admin account yourself via the Supabase SQL editor — this app has no public self-serve signup. Insert a `tenants` row (this seeds default roles/vehicle sizes/etc. via trigger), a `user_profiles` row with `role='admin'` for a user you create under Authentication → Users, and an `employees` row (`user_id` = that same auth user) with an `employee_roles` row linking it to the tenant's `admin` role — the capability-based RBAC that Phase 2 (jobs/sales/shifts) uses reads permissions through `employees`/`employee_roles`, not `user_profiles.role` alone.
5. Copy your project's URL and anon key (Settings → API) into `.env`.

## Environment variables

See `.env.example`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Never commit `.env` (it's gitignored) or put a service-role key in client code.

## Database migrations

All schema changes are SQL files under `supabase/migrations/`, applied in order via `supabase db push`. Never hand-create tables in the dashboard. Tenant-specific one-off data (like the real OtoKwikk catalog load) lives under `supabase/seed/` instead, since it's business data, not schema.

## Seed data

`supabase/seed/washwash_catalog.sql` and `supabase/seed/washwash_vehicle_size_remap.sql` are tenant-specific data loads for the actual WashWash/OtoKwikk tenant, not generic reusable seed data — read their header comments before reusing the pattern for a different tenant.

## Running locally

```bash
npm run dev
```

## Building

```bash
npm run build
```

Runs `tsc -b` then `vite build`.

## Deploying

Not yet configured. Target is Netlify or Vercel (static SPA build) once the app is further along.

## Offline architecture

- Catalog data (services, prices, vehicle sizes, products, bays, employees, vehicles, customers) is cached in IndexedDB via Dexie and refreshed on login and reconnect, so the register can build a job offline without a network round-trip.
- Writes go through a `mutation_queue` outbox: the UI never calls Supabase directly for a mutating action, it writes an optimistic local record and enqueues one coarse-grained mutation (e.g. "create this job"), then a background sync engine flushes the queue on reconnect/interval.
- Every offline-created record carries a client-generated UUID as its idempotency key, so a retried sync (e.g. after a dropped response) is a safe no-op instead of a duplicate.
- Server-side, any shared mutable value (stock, job/ticket numbering) is always updated via a relative delta inside a Postgres function, never an absolute value sent from the client — this is what makes two devices syncing concurrently safe without conflict-resolution logic.
- **Exception**: collecting payment (`create_sale`) is online-only. It needs real, already-synced `job_service` ids, and the job queue board only ever shows jobs that have already synced — so this isn't a practical offline gap, just a deliberate scope line for v1.

## User roles

Legacy (drives the old ticket-POS tables): `admin`, `manager`, `cashier`, stored on `user_profiles.role`.

New capability-based system (drives everything built from Phase 1 onward): tenants get six default roles (Admin/Owner, Manager, Supervisor, Cashier, Car Wash Attendant, Detailer) seeded with a starting permission set; an employee can hold more than one role. See `supabase/migrations/0009_rbac_schema.sql` for the full permission catalog and default grants — these are a starting point, adjustable per tenant once role-management UI exists.

## Commission logic

Implemented (roadmap Phase 3). Commission is computed when a job completes (`complete_job()`), one entry per assigned attendant per service line, via an idempotent Postgres function — independent of whether the job has been paid for. Supports fixed-pool, percentage-of-price, fixed-per-attendant, and points methods; custom/role-based splits work via a per-attendant split-percentage override on the crew assignment (no separate role-rate table). No UI yet to set that split percentage — it's supported end-to-end at the schema/RPC level, just needs a Register control. Payroll periods (rolling ledger entries into locked pay periods) aren't built yet.

## Inventory logic

Not implemented yet (roadmap Phase 4). The architecture plan calls for a proper stock ledger (never an overwritten running total) and size-dependent service recipes that auto-deduct consumables on job-service completion.

## Known limitations

- No payroll periods, inventory, expenses, promotions, or loyalty yet (roadmap Phases 3–6 continued).
- No UI to set a custom commission split percentage at crew-assignment time.
- No void/refund flow for a completed sale yet.
- No PWA/service worker (planned for roadmap Phase 7) — offline support today is the Dexie outbox only, not full installability/asset caching.
- Not deployed anywhere yet.
- This is an operational/management tool, not an accounting system — nothing here should be treated as BIR-compliant invoicing or statutory payroll unless and until those are explicitly built and validated.

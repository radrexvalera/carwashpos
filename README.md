# OtoKwikk Car Wash Management System

A production-track Philippine car wash management system: POS, job queue, attendant commission/payroll, inventory, expenses, and owner reporting, built offline-first for spotty shop connectivity.

This README reflects what's actually implemented. See `CHANGELOG.md` for phase-by-phase history.

## Project overview

Built for a single-branch Philippine car wash (OtoKwikk / tenant "WashWash"), architected so a second branch or a second business can be added later without a schema rewrite — every table carries `tenant_id` (the business) and, where relevant, `location_id` (the branch).

**Status**: Phase 1 (Foundation) of the new 8-phase roadmap is complete: multi-tenant RBAC, employee registry, vehicle-size/service-catalog taxonomy, business settings. An earlier, simpler ticket-based POS + bay board (built before the roadmap pivot) still runs alongside this, unused by new work, until the roadmap's Phase 2 replaces it with a proper job/sale model.

## Architecture

- **Frontend**: React + TypeScript + Vite, Tailwind CSS v4, shadcn/ui (New York style), lucide-react icons, react-hook-form + zod for forms.
- **Backend**: Supabase — Postgres, Auth, Row-Level Security, Realtime. All business logic that must be atomic (pricing, stock/commission deltas, idempotent creation) lives in Postgres functions, never computed authoritatively on the client.
- **Offline**: Dexie.js (IndexedDB) as a local read-cache for catalog data and an outbox (`mutation_queue`) for writes made while offline, synced via a background flush loop once reconnected. Client-generated UUIDs make retried syncs idempotent.
- **Multi-tenant**: one Supabase project serves multiple businesses; every table is tenant-scoped via RLS policies checking `tenant_id = current_tenant_id()`.
- **RBAC**: two layers exist today — a legacy `user_profiles.role` enum (admin/manager/cashier) that still drives the old ticket-POS tables' RLS, and a newer capability-based system (`roles`/`permissions`/`role_permissions`/`employee_roles`, checked via `has_permission('some_capability')`) that all new work uses. These will converge once the old ticket-POS tables are replaced.

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
4. Provision the first tenant + admin account yourself via the Supabase SQL editor — this app has no public self-serve signup (see `supabase/migrations/0001_init_schema.sql` for the schema, and insert a `tenants` row + a `user_profiles` row with `role='admin'` for a user you create under Authentication → Users).
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

- Catalog data (services, prices, vehicle sizes, products, bays) is cached in IndexedDB via Dexie and refreshed on login and reconnect, so the register can build a transaction without a network round-trip.
- Writes go through a `mutation_queue` outbox: the UI never calls Supabase directly for a mutating action, it writes an optimistic local record and enqueues one coarse-grained mutation (e.g. "complete this ticket"), then a background sync engine flushes the queue on reconnect/interval.
- Every offline-created record carries a client-generated UUID as its idempotency key, so a retried sync (e.g. after a dropped response) is a safe no-op instead of a duplicate.
- Server-side, any shared mutable value (stock, ticket numbering) is always updated via a relative delta inside a Postgres function, never an absolute value sent from the client — this is what makes two devices syncing concurrently safe without conflict-resolution logic.

## User roles

Legacy (drives the old ticket-POS tables): `admin`, `manager`, `cashier`, stored on `user_profiles.role`.

New capability-based system (drives everything built from Phase 1 onward): tenants get six default roles (Admin/Owner, Manager, Supervisor, Cashier, Car Wash Attendant, Detailer) seeded with a starting permission set; an employee can hold more than one role. See `supabase/migrations/0009_rbac_schema.sql` for the full permission catalog and default grants — these are a starting point, adjustable per tenant once role-management UI exists.

## Commission logic

Not implemented yet (roadmap Phase 3). The architecture plan calls for commission to be computed when an individual job-service line completes (not the whole job, not the payment), via an idempotent Postgres function, supporting fixed-pool/percentage/fixed-per-attendant/custom-split/role-based/points methods.

## Inventory logic

Not implemented yet (roadmap Phase 4). The architecture plan calls for a proper stock ledger (never an overwritten running total) and size-dependent service recipes that auto-deduct consumables on job-service completion.

## Known limitations

- No jobs/POS/sales module yet under the new roadmap — the old ticket-based POS is a stand-in, disconnected from the new employee/RBAC system.
- No commission, payroll, inventory, expenses, promotions, loyalty, or reporting yet.
- No PWA/service worker (planned for roadmap Phase 7) — offline support today is the Dexie outbox only, not full installability/asset caching.
- Not deployed anywhere yet.
- This is an operational/management tool, not an accounting system — nothing here should be treated as BIR-compliant invoicing or statutory payroll unless and until those are explicitly built and validated.

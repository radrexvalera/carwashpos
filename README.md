# OtoKwikk Car Wash Management System

A production-track Philippine car wash management system: POS, job queue, attendant commission/payroll, inventory, expenses, and owner reporting, built offline-first for spotty shop connectivity.

This README reflects what's actually implemented. See `CHANGELOG.md` for phase-by-phase history.

## Project overview

Built for a single-branch Philippine car wash (OtoKwikk / tenant "WashWash"), architected so a second branch or a second business can be added later without a schema rewrite — every table carries `tenant_id` (the business) and, where relevant, `location_id` (the branch).

**Status**: Phases 1–6 of the new 8-phase roadmap are complete. Phase 1: multi-tenant RBAC, employee registry, vehicle-size/service-catalog taxonomy, business settings. Phase 2: the real job-based POS — Register (create a job), Job Queue (Kanban board), Collect Payment, and cashier shift management. Phase 3: commission rules, an append-only commission ledger computed when a job completes, an attendant "My Commission" dashboard, a manager-facing commission report, and payroll periods (generate → edit → lock → mark paid, with post-lock corrections as adjustment rows, never edits). Phase 4: a proper inventory ledger (items, categories, units, purchases, service recipes with auto-deduction on job completion, manual adjustments with a required reason), retail products sold through the same POS screen as services. Phase 5: operating-expense tracking (record/void, categorized), a sales report (revenue mix, top services, expenses by category), and a real owner dashboard (today's sales/expenses/net, pending commission, jobs on the floor, low-stock count). Phase 6 ("advanced features," five slices): 6a staff-applied promotions and a points-based loyalty program computed server-side inside checkout; 6b fleet accounts with real deferred/on-account billing (a sale can go unpaid or partially paid at checkout and be settled against a specific invoice later, capped by a credit limit); 6c memberships as a stamp card (buy N of a customizable service, the Nth is free) — a separate reward ledger from loyalty, since a shop can run both at once; 6d appointments — book ahead of time, check in later into a real job via the existing job-creation flow; 6e vehicle inspections — pre-service condition photos/notes at intake, this repo's first use of Supabase Storage. The earlier, simpler ticket-based POS + bay board built before the roadmap pivot has been fully retired (deleted from the app; its database tables remain in Postgres, unused, along with the old `products`/`consumables`/`service_bom` tables which Phase 4 dropped outright).

Phase 7 (offline/PWA hardening, in progress): 7a fixed a real gap where a job created offline was completely invisible on the Job Queue board until it synced — it now shows immediately as a labeled pending card, replaced automatically by the real card once synced, plus a manual retry path for a mutation that permanently failed.

**Remaining on the roadmap**: the rest of Phase 7 (PWA installability/asset caching, fuller sync-engine hardening) and Phase 8 (production hardening) — not yet started.

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

- Catalog data (services, prices, vehicle sizes, inventory items, bays, employees, vehicles, customers) is cached in IndexedDB via Dexie and refreshed on login and reconnect, so the register can build a job offline without a network round-trip.
- Writes go through a `mutation_queue` outbox: the UI never calls Supabase directly for a mutating action, it writes an optimistic local record and enqueues one coarse-grained mutation (e.g. "create this job"), then a background sync engine flushes the queue on reconnect/interval.
- Every offline-created record carries a client-generated UUID as its idempotency key, so a retried sync (e.g. after a dropped response) is a safe no-op instead of a duplicate.
- Server-side, any shared mutable value (stock, job/ticket numbering) is always updated via a relative delta inside a Postgres function, never an absolute value sent from the client — this is what makes two devices syncing concurrently safe without conflict-resolution logic.
- **Exception**: collecting payment (`create_sale`) is online-only. It needs real, already-synced `job_service` ids — a deliberate scope line for v1, not something Phase 7 changes.
- A job created offline shows immediately on the Job Queue board as a labeled pending card (no number yet, "Syncing…") rather than being invisible until sync (Phase 7a).
- A mutation that exhausts its retries is left `'failed'` with a manual "Retry" action on its pending card (Phase 7a) — the sync engine itself still has no backoff/jitter between attempts, and there's no broader failures panel yet (later Phase 7 work).

## PWA / installability

Implemented (roadmap Phase 7b). The app is installable (a manifest + icons generated from the existing brand mark) and its shell (JS/CSS/HTML) loads with zero connectivity via a service worker (`public/sw.js`), gated to production builds only. **Hand-rolled, not `vite-plugin-pwa`** — this project is on Vite 8.3.0, newer than that plugin's verified compatibility as of when this was built, so a small (~30-line) hand-written service worker avoided an unverified peer-dependency gamble on a live production app; it's simple enough to fully understand and matches this project's existing preference for explicit code over generated tooling (hand-maintained `types.ts`, hand-written SQL migrations). Revisit `vite-plugin-pwa` later if its Vite 8 support firms up.

The service worker caches **same-origin GET requests only**, network-first with a cache fallback — it never touches the Supabase API or any other cross-origin request, since the existing Dexie/mutation-queue outbox above already owns that offline path correctly and the two must never overlap. Icons are regenerated with `node scripts/generate-pwa-icons.mjs` (rasterizes `public/favicon.svg` via `sharp`, a devDependency) if the logo ever changes — not run automatically on every build.

## User roles

Legacy (drives the old ticket-POS tables): `admin`, `manager`, `cashier`, stored on `user_profiles.role`.

New capability-based system (drives everything built from Phase 1 onward): tenants get six default roles (Admin/Owner, Manager, Supervisor, Cashier, Car Wash Attendant, Detailer) seeded with a starting permission set; an employee can hold more than one role. See `supabase/migrations/0009_rbac_schema.sql` for the full permission catalog and default grants — these are a starting point, adjustable per tenant once role-management UI exists.

## Commission logic

Implemented (roadmap Phase 3, complete). Commission is computed when a job completes (`complete_job()`), one entry per assigned attendant per service line, via an idempotent Postgres function — independent of whether the job has been paid for. Supports fixed-pool, percentage-of-price, fixed-per-attendant, and points methods; custom/role-based splits work via a per-attendant split-percentage override on the crew assignment (no separate role-rate table). No UI yet to set that split percentage — it's supported end-to-end at the schema/RPC level, just needs a Register control.

Payroll periods roll unclaimed commission into one entry per employee for a date range; manual fields (base pay/tips/bonus/cash advance/deductions) are editable while a period is a draft, then frozen once locked (RLS-enforced), with post-lock corrections recorded as new adjustment rows rather than edits.

## Inventory logic

Implemented (roadmap Phase 4, complete). `inventory_items` carries no stock/cost columns of its own — `inventory_transactions` is the single append-only ledger, and `record_inventory_transaction()` is the only write path (computes new balances server-side under a per-item advisory lock, never an overwritten running total). Purchases (`create_purchase_order()`) post a `stock_in` transaction per line; manual counts/corrections go through `adjust_inventory_stock()`, which requires the `can_manage_inventory` permission and a non-empty reason. Service recipes (`service_recipe_items`, optionally per vehicle size) auto-deduct on job-service completion inside the same transaction as commission — same idempotency guarantee as commission (a repeated completion is a no-op). Retail products are sold through the same Collect Payment screen as services, deducting stock via a `retail_sale` transaction.

## Expenses & reporting

Implemented (roadmap Phase 5, complete). `record_expense()`/`void_expense()` are the only write paths for `expenses`, gated by `can_manage_expenses` — a correction is a void with a required reason, never a row edit (a trigger blocks editing a recorded expense's financial fields directly). Reports (Sales Report, owner Dashboard) are queries over existing tables, not new base tables — no separate reporting schema.

## Promotions & loyalty

Implemented (roadmap Phase 6a, complete). Promotions (`promotions`/`promotion_services`) are staff-applied at checkout, not customer-facing codes — percentage or fixed-peso off, optionally restricted to specific services, with an optional minimum spend and date range. Loyalty (`loyalty_transactions`) is a points-based, append-only ledger (same discipline as `inventory_transactions`/`commission_ledger` — balance is a derived sum via the `loyalty_balances` view, never a stored counter); points earn once a sale is actually paid (post every discount — an unpaid on-account sale, see below, does not earn until it's settled) and redeem for a peso-value discount, capped to what the sale can absorb. Both are computed and validated entirely server-side inside `create_sale()`, stacked on top of (not replacing) the existing manual per-line discount. `loyalty_earn_rate`/`loyalty_redemption_value` are tunable per tenant via Settings.

## Fleet accounts

Implemented (roadmap Phase 6b, complete). A fleet account (`fleet_accounts`) is a 1:1 add-on to a `company`-type `customer` — no separate fleet↔vehicle join table, since `vehicles.customer_id` already supports many vehicles per customer. `create_sale()` accepts `billing_type = 'on_account'`, which allows a sale to go out unpaid or partially paid (only overpayment is rejected), checked against the account's `credit_limit` via the `fleet_account_balances` view. `record_fleet_settlement()` pays down a specific invoice later, partial settlements allowed, gated on `can_manage_fleet_accounts` (an office/accounting action, not tied to having an open shift).

## Memberships (stamp card)

Implemented (roadmap Phase 6c, complete). Not a subscription — a stamp card: buy N of a customizable service, the Nth is free. `membership_programs`/`membership_program_services` let an admin pick the name, stamps required, and which service(s) qualify. `membership_stamps` is a separate append-only ledger from `loyalty_transactions` (a shop can run a points program and a stamp-card promo at once) — same derived-sum-view discipline as every other ledger here. `create_sale()`'s optional `membership_redemption` zeroes one specific line's contribution without rewriting `sale_items`' real list price. Earning is gated on the sale actually being paid; redemption isn't (a redeemed stamp gets its free item today regardless of when the rest of an on-account invoice is settled) — and `record_fleet_settlement()` posts the deferred earn (for both loyalty and stamps) the moment an on-account sale reaches `paid`.

## Appointments

Implemented (roadmap Phase 6d, complete). A booking made ahead of time, checked in later into a real job. Unlike every other Phase 6 slice, this adds no ledger and no new RPC — check-in reuses `create_job()` directly, then a plain RLS-gated update marks the appointment `converted`, the same shape job status transitions already use. `appointments`/`appointment_services` reuse the existing `can_manage_jobs` permission rather than a new one. An appointment always references a real `vehicle_id`, same as a job — booking for a car not yet in the system means resolving/creating that vehicle first via the same flow `RegisterPage` already has.

## Vehicle inspections

Implemented (roadmap Phase 6e, complete — this closes out Phase 6). Pre-service condition documentation: photos + notes of existing scratches/dents/damage, captured at intake before work starts. Reached from an "Inspect" action on Job Queue's Waiting-column job cards. This repo's first use of Supabase Storage — a private bucket (`vehicle-inspection-photos`), provisioned via migration like every other piece of schema here, with RLS on `storage.objects` using the same `current_tenant_id()` tenant-scoping shape as every other table, keyed off a `{tenant_id}/{job_id}/...` path convention. Photos are served via signed URLs generated on read, never a public URL. `vehicle_inspections`/`vehicle_inspection_photos` reuse `can_manage_jobs` (no new permission) and the same "plain client insert + `created_by default auth.uid()`" shape established for appointments.

## Known limitations

- No UI to set a custom commission split percentage at crew-assignment time.
- No void/refund flow for a completed sale yet.
- No low-stock alert surfaced outside the inventory items table itself (no dashboard widget/notification yet).
- No PWA/service worker (planned for roadmap Phase 7) — offline support today is the Dexie outbox only, not full installability/asset caching.
- Not deployed anywhere yet.
- This is an operational/management tool, not an accounting system — nothing here should be treated as BIR-compliant invoicing or statutory payroll unless and until those are explicitly built and validated.

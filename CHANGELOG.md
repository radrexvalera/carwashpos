# Changelog

Major implementation changes, newest first. This tracks the new 8-phase roadmap (OtoKwikk Car Wash Management System); see the git history before 2026-09-21 for the earlier, since-superseded simple-POS build (Phases 0–2 of the original scope).

## Phase 3 — Commission (2026-09-21/22)

- **Commission rules**: one rule per service, or a tenant-wide default used as fallback. Supports fixed-pool, percentage-of-price, fixed-per-attendant, and points methods directly; custom/role-based splits work via a per-attendant split-percentage override on the existing crew assignment (no separate role-rate table needed).
- **Commission ledger**: a proper append-only ledger — a reversal will be a new row referencing what it reverses, never an edit to the original.
- **`complete_job()`**: the "Picked up" action now completes every open job-service line and computes commission for each atomically, in one transaction — idempotent (a repeated call is a no-op), and independent of whether the job has been paid for yet.
- **My Commission**: an attendant's (or anyone's) own today's-earnings dashboard + recent history.
- **Commission Report**: manager view, totals by employee then by service, for a date range.
- Verified via SQL under real RLS enforcement: a 2-attendant fixed-pool job splits evenly, a repeat completion doesn't double-pay, and a 70/30 custom split computes correctly.
- Known gap: no UI yet to set a custom split percentage at crew-assignment time — works end-to-end at the schema/RPC level, needs a Register control.
- **Payroll periods**: `generate_payroll_period()` rolls unclaimed commission into one entry per employee for a date range (daily/weekly/semi-monthly/custom); manual fields (base pay/tips/bonus/cash advance/deductions) are editable while a period is a draft, `net_pay` is a generated column; `lock_payroll_period()` freezes entries (enforced by RLS, not just UI); `mark_payroll_period_paid()` propagates paid status back onto the commission ledger. Post-lock corrections are new `payroll_adjustments` rows, never edits. This closes out Phase 3.

## Phase 2 — Core Car Wash POS (2026-09-21)

- **Customers/vehicles**: registered customers are optional (a walk-in vehicle has no `customer_id` at all); vehicle make/model are free text, never FKs — the make/model lookup is only a convenience default. No stored `total_visits`/`total_spend`/`last_visit`/`loyalty_points` on customers — derived from jobs/sales at read time instead of mutable counters that could drift.
- **Jobs**: `jobs` / `job_services` / `job_service_attendants` / `job_status_history`. A job is the shop-floor unit of work, created independent of payment. Attendants are assigned per SERVICE LINE, not per job, so different crew can work different services on the same vehicle — this is what Phase 3's commission ledger will key off of. `create_job()` prices every service server-side and assigns a `JOB-YYYYMMDD-NNNN` number, atomically, with crew assignments.
- **Sales/payments**: `sales` / `sale_items` / `payments`, plus `wash_bays` (renamed from `bays`), `cashier_shifts` / `cash_movements`. A sale is deliberately decoupled from job status — created whenever payment is collected, not gated by job completion — but requires an open shift. `create_sale()` bills job-service lines (with an optional checkout-time discount) or retail products, prevents double-billing the same job-service, and validates split payments. `close_shift()` computes expected cash from the actual sales/cash-movement ledger, never a client-supplied figure.
- Frontend: the old ticket-based POS and bay board are **retired** (deleted, superseded) in favor of Register (job builder) → Job Queue (Kanban board, live via Realtime) → Collect Payment (reached from an unpaid job card) → My Shift. Payment collection is online-only by design; job creation and shop-floor status updates remain offline-capable via the same outbox pattern as before.
- All backend logic verified end-to-end via SQL under real RLS enforcement (not the `postgres`-role bypass `db query` normally runs as): shift → job → crew assignment → split-payment sale → double-bill rejection → cash reconciliation.

## Phase 1 — Foundation (2026-09-21)

- **RBAC**: capability-based `permissions` / `roles` / `role_permissions` / `employee_roles`, plus a `has_permission()` RLS helper. Additive alongside the existing `user_profiles.role` mechanism, which still drives the old Phase 0–2 tables untouched.
- **Employees**: a registry separate from login-linked `user_profiles`, since many attendants never log in. Supports multiple roles per employee.
- **Vehicle taxonomy rework**: collapsed the old two-axis classification (Motorcycle-Small/Big + S/M/L/XL/XXL, and a separate Sedan/Crossover/SUV/Van used only by Tint) onto a single 6-tier ladder — Motorcycle/Small/Medium/Large/XL/XXL — used for all pricing. `vehicle_makes`/`vehicle_models` added as a convenience lookup (never drives pricing). Existing OtoKwikk pricing data remapped onto the new ladder.
- **Service catalog rework**: `service_categories` replaces the old free-text category column; `services` gained `pricing_type` (matrix/flat/starting_at/quoted) and `flat_price` for non-matrix services.
- **Settings**: one configurable business-info row per tenant (name, address, contact, receipt header/footer, numbering prefix).
- Frontend: Employees and Settings admin pages (first use of react-hook-form + zod, now the established pattern for future forms); catalog admin pages reworked for the renamed tables.

## Earlier build (superseded)

A simpler payment-first ticket POS + bay board was built first (see git history before this changelog existed) and is being replaced by this roadmap's job/sale model, starting with Phase 2. The original service catalog and real OtoKwikk pricing data were carried forward into this rebuild.

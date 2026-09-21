# Changelog

Major implementation changes, newest first. This tracks the new 8-phase roadmap (OtoKwikk Car Wash Management System); see the git history before 2026-09-21 for the earlier, since-superseded simple-POS build (Phases 0–2 of the original scope).

## Phase 1 — Foundation (2026-09-21)

- **RBAC**: capability-based `permissions` / `roles` / `role_permissions` / `employee_roles`, plus a `has_permission()` RLS helper. Additive alongside the existing `user_profiles.role` mechanism, which still drives the old Phase 0–2 tables untouched.
- **Employees**: a registry separate from login-linked `user_profiles`, since many attendants never log in. Supports multiple roles per employee.
- **Vehicle taxonomy rework**: collapsed the old two-axis classification (Motorcycle-Small/Big + S/M/L/XL/XXL, and a separate Sedan/Crossover/SUV/Van used only by Tint) onto a single 6-tier ladder — Motorcycle/Small/Medium/Large/XL/XXL — used for all pricing. `vehicle_makes`/`vehicle_models` added as a convenience lookup (never drives pricing). Existing OtoKwikk pricing data remapped onto the new ladder.
- **Service catalog rework**: `service_categories` replaces the old free-text category column; `services` gained `pricing_type` (matrix/flat/starting_at/quoted) and `flat_price` for non-matrix services.
- **Settings**: one configurable business-info row per tenant (name, address, contact, receipt header/footer, numbering prefix).
- Frontend: Employees and Settings admin pages (first use of react-hook-form + zod, now the established pattern for future forms); catalog admin pages reworked for the renamed tables.

## Earlier build (superseded)

A simpler payment-first ticket POS + bay board was built first (see git history before this changelog existed) and is being replaced by this roadmap's job/sale model, starting with Phase 2. The original service catalog and real OtoKwikk pricing data were carried forward into this rebuild.

-- Replace the generic 'e_wallet' bucket with the specific manually-recorded methods this business
-- actually uses (GCash and Maya are separate e-wallets, plus bank transfer) so the "revenue by
-- payment method" report (Phase 7) can distinguish them instead of lumping them together. Still
-- manual-record-only per the plan's Confirmed Design Decisions #3 -- no live gateway integration.
alter table public.ticket_payments drop constraint ticket_payments_method_check;
alter table public.ticket_payments add constraint ticket_payments_method_check
  check (method in ('cash', 'gcash', 'maya', 'bank_transfer', 'card'));

-- Adds specific bank/e-wallet rails on top of the existing generic 'bank_transfer' bucket (kept
-- for anything not in this list), so reconciliation against actual bank statements doesn't need
-- everything lumped into one "Bank Transfer" total. Applied to both sales payments and expense
-- payments, which have always shared the same method vocabulary.
alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'gcash', 'maya', 'bank_transfer', 'card', 'maribank', 'gotyme', 'rcbc', 'bpi', 'unionbank', 'qrph'));

alter table public.expenses drop constraint expenses_payment_method_check;
alter table public.expenses add constraint expenses_payment_method_check
  check (payment_method in ('cash', 'gcash', 'maya', 'bank_transfer', 'card', 'maribank', 'gotyme', 'rcbc', 'bpi', 'unionbank', 'qrph'));

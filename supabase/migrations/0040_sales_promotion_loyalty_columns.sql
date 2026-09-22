-- customer_id is resolved server-side by create_sale() from jobs.vehicle_id -> vehicles.customer_id
-- when a job_id is given; a pure retail sale with no job stays customer_id = null (no loyalty
-- accrual for walk-in retail-only purchases in this pass).
alter table public.sales
  add column customer_id uuid references public.customers(id),
  add column promotion_id uuid references public.promotions(id),
  add column promotion_discount_amount numeric(12, 2) not null default 0,
  add column loyalty_points_redeemed int not null default 0,
  add column loyalty_discount_amount numeric(12, 2) not null default 0;

-- Extend the existing tamper guard so these new financial/identity columns get the same
-- protection as subtotal/discount_total/tax_total/total already have.
create or replace function public.prevent_sale_tampering()
returns trigger
language plpgsql
as $$
begin
  if new.sale_number is distinct from old.sale_number
    or new.subtotal is distinct from old.subtotal
    or new.discount_total is distinct from old.discount_total
    or new.tax_total is distinct from old.tax_total
    or new.total is distinct from old.total
    or new.tenant_id is distinct from old.tenant_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.customer_id is distinct from old.customer_id
    or new.promotion_id is distinct from old.promotion_id
    or new.promotion_discount_amount is distinct from old.promotion_discount_amount
    or new.loyalty_points_redeemed is distinct from old.loyalty_points_redeemed
    or new.loyalty_discount_amount is distinct from old.loyalty_discount_amount
  then
    raise exception 'Sale financial/identity fields can only be set by create_job/create_sale flows';
  end if;
  return new;
end;
$$;

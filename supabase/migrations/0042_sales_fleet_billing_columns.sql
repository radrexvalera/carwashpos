alter table public.sales
  add column billing_type text not null default 'immediate' check (billing_type in ('immediate', 'on_account')),
  add column payment_status text not null default 'paid' check (payment_status in ('paid', 'partial', 'unpaid'));

-- payment_status is deliberately left OUT of the guard below -- it's the one field
-- record_fleet_settlement() (next migration) is expected to update after creation.
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
    or new.billing_type is distinct from old.billing_type
  then
    raise exception 'Sale financial/identity fields can only be set by create_job/create_sale flows';
  end if;
  return new;
end;
$$;

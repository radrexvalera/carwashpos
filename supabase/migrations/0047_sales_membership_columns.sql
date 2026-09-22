-- membership_redeemed_job_service_id is stored (not just membership_program_id) so that
-- record_fleet_settlement() can correctly exclude exactly the redeemed line, not the whole
-- program, when it later posts deferred stamp-earn rows for an on_account sale's OTHER lines.
alter table public.sales
  add column membership_program_id uuid references public.membership_programs(id),
  add column membership_redeemed_job_service_id uuid references public.job_services(id),
  add column membership_discount_amount numeric(12, 2) not null default 0;

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
    or new.membership_program_id is distinct from old.membership_program_id
    or new.membership_redeemed_job_service_id is distinct from old.membership_redeemed_job_service_id
    or new.membership_discount_amount is distinct from old.membership_discount_amount
  then
    raise exception 'Sale financial/identity fields can only be set by create_job/create_sale flows';
  end if;
  return new;
end;
$$;

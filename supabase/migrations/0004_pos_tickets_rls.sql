-- tickets/ticket_line_items/ticket_payments are deliberately NOT directly insertable by clients --
-- creation only happens through complete_ticket() (0005), which is SECURITY DEFINER and so
-- bypasses these policies for its own writes. This forces every ticket into existence through one
-- vetted, atomic path (consistent price lookups, validated payment totals, correct stock deltas)
-- instead of trusting a client to assemble a financially-correct multi-table write itself.

alter table public.tenant_ticket_counters enable row level security;
-- No policies at all: only complete_ticket() (security definer) touches this table.

alter table public.tickets enable row level security;

create policy tickets_select on public.tickets
  for select using (tenant_id = public.current_tenant_id());

-- Needed for Phase 2 (bay board): staff move a ticket through waiting/in_bay/ready_for_pickup/
-- picked_up_paid, and may (re)assign bay_id. The tickets_prevent_financial_tampering trigger
-- (0003) stops this same policy from being used to rewrite what was actually charged.
create policy tickets_update on public.tickets
  for update using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

alter table public.ticket_line_items enable row level security;

create policy ticket_line_items_select on public.ticket_line_items
  for select using (tenant_id = public.current_tenant_id());

alter table public.ticket_payments enable row level security;

create policy ticket_payments_select on public.ticket_payments
  for select using (tenant_id = public.current_tenant_id());

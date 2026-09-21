-- Phase 2: the bay/queue board is a read-model + status-mutation UI over Phase 1's tickets table --
-- no new core tables, just what's needed to display it well and keep it live.

alter table public.tickets add column bay_entered_at timestamptz;

-- One row per non-voided ticket with its bay name and a human-readable summary of what's on it,
-- so the board doesn't need a separate query per ticket for line items. security_invoker means it
-- runs with the caller's own RLS, so tenant isolation is inherited for free from the underlying
-- tables -- no separate policy to write or forget.
create view public.ticket_board_entries
with (security_invoker = true) as
select
  t.id,
  t.tenant_id,
  t.client_generated_id,
  t.ticket_number,
  t.status,
  t.bay_id,
  b.name as bay_name,
  t.bay_entered_at,
  t.created_at,
  t.completed_at,
  t.total,
  (
    select string_agg(
      coalesce(s.name, p.name) || case when tli.quantity > 1 then ' x' || tli.quantity::text else '' end,
      ', ' order by tli.created_at
    )
    from public.ticket_line_items tli
    left join public.services s on s.id = tli.service_id
    left join public.products p on p.id = tli.product_id
    where tli.ticket_id = t.id
  ) as summary
from public.tickets t
left join public.bays b on b.id = t.bay_id
where t.status != 'voided';

grant select on public.ticket_board_entries to authenticated;

-- Lets the bay board subscribe to live ticket changes (status/bay_id updates from any device) via
-- Supabase Realtime instead of only polling. Realtime respects the tickets_select RLS policy, so
-- a client only receives events for its own tenant.
alter publication supabase_realtime add table public.tickets;

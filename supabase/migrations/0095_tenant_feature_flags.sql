-- This app has accumulated business-specific features over time (repaint tracking being the
-- first) that not every customer wants cluttering their UI. `settings.features` is a tenant-scoped
-- on/off switch, keyed by feature name, set per customer via the Owner Console (not self-service --
-- which features a tenant gets is a product/sales decision, not something a tenant admin toggles
-- for themselves). An absent or false key defaults to off, so adding a new gated feature later
-- never silently switches on for a tenant who hasn't been granted it.
alter table public.settings add column features jsonb not null default '{}'::jsonb;

-- Test123 is the one tenant actually using repaint tracking today -- keep its behavior unchanged.
-- Backfilled BEFORE the tamper-guard trigger below exists, since that trigger would otherwise
-- reject this very statement (a plain migration run carries no service_role JWT context).
update public.settings set features = features || '{"repaint": true}'::jsonb
where tenant_id = '8a1042d4-1a0c-41a0-8eb9-79253e9f5cb3';

-- Ordinary tenant admins update settings through updateSettings() (RLS: can_manage_settings),
-- which is the self-service path for business_name/logo/receipt config etc. -- features must NOT
-- be reachable through that same path, or any tenant could just grant themselves a feature from
-- the browser console. Only the Owner Console edge function (service_role, bypasses RLS entirely)
-- is allowed to change it.
create or replace function public.prevent_settings_features_tampering()
returns trigger
language plpgsql
as $$
begin
  if new.features is distinct from old.features and coalesce(auth.role(), '') != 'service_role' then
    raise exception 'Feature flags can only be changed from the Owner Console';
  end if;
  return new;
end;
$$;

create trigger settings_prevent_features_tampering
  before update on public.settings
  for each row execute function public.prevent_settings_features_tampering();

-- job_has_repaint_line() (0094) previously keyed the whole manual-commission-for-repaint behavior
-- off nothing but a service category literally named "Repaint" -- harmless for any tenant that
-- never creates one, but now that the flag exists, make it the single source of truth: a tenant
-- must be granted the "repaint" feature AND have the category for this behavior to engage, so an
-- unrelated tenant naming a category "Repaint" for their own reasons never accidentally trips
-- special-cased commission handling.
create or replace function public.job_has_repaint_line(p_tenant_id uuid, p_job_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    coalesce((select (features ->> 'repaint')::boolean from public.settings where tenant_id = p_tenant_id), false)
    and exists (
      select 1
      from public.job_services js
      join public.services s on s.id = js.service_id
      join public.service_categories sc on sc.id = s.category_id
      where js.job_id = p_job_id and js.tenant_id = p_tenant_id and sc.name ilike 'Repaint'
    );
$$;

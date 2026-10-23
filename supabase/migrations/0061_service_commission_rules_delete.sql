-- Lets a manager clear a per-service override and fall back to the default again, instead of only
-- ever being able to overwrite it with another value. No delete policy existed before, so a DELETE
-- would have silently affected 0 rows (same gap as service_categories/wash_bays).
create policy service_commission_rules_delete on public.service_commission_rules
  for delete using (tenant_id = public.current_tenant_id() and public.has_permission('can_manage_catalog'));

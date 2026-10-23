-- Business logo, shown in the app header and on printed receipts/payslips. Stored as a public
-- URL (not a signed one) on settings.logo_url -- a logo is meant to be customer-facing by design
-- (it's printed on receipts handed to customers), so unlike vehicle-inspection-photos there's no
-- reason to pay for signed-URL refresh plumbing across every place it's rendered (header, Receipt,
-- Payslip, react-pdf <Image>, none of which can attach an Authorization header to an <img src>).
alter table public.settings add column logo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-logos', 'business-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp']);

-- Public bucket: anyone with the URL can view (same as any other public-asset bucket). Writes
-- stay tenant-scoped and gated the same way every other settings mutation is.
create policy business_logos_select on storage.objects
  for select using (bucket_id = 'business-logos');

create policy business_logos_insert on storage.objects
  for insert with check (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.has_permission('can_manage_settings')
  );

create policy business_logos_update on storage.objects
  for update using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.has_permission('can_manage_settings')
  );

create policy business_logos_delete on storage.objects
  for delete using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.has_permission('can_manage_settings')
  );

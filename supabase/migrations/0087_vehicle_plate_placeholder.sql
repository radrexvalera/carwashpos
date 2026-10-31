-- Plate number is NOT NULL + unique(tenant_id, plate_number) -- a vehicle with no plate yet
-- (brand new, or not yet registered) had no way to be added at all. Rather than making plate_number
-- nullable (which would ripple into every one of the ~20 places that display it as a plain string,
-- from receipts to payslips to job board sync), the customer's name is stored INTO plate_number
-- itself when no real plate is given -- it's still a unique, human-readable identifier, so every
-- existing display site keeps working unchanged. This flag just distinguishes "this is actually a
-- plate" from "this is a stand-in name" for the one or two UI spots that want to show that
-- distinction (e.g. a "no plate" hint), and gets cleared the moment someone edits in a real plate.
alter table public.vehicles add column plate_is_placeholder boolean not null default false;

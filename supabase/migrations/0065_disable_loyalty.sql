-- The loyalty feature's own page was already unrouted (nav + Collect Payment UI removed earlier
-- alongside promotions/memberships/fleet billing), but create_sale() was still silently accruing
-- points on every completed sale at the default rate (1 point per 1 currency unit spent) -- with
-- no UI left anywhere to view, manage, or redeem them. Zeroing the rate (rather than touching
-- create_sale()'s own logic, which is the app's largest and highest-risk RPC) is the safe way to
-- actually stop that accrual rather than just hiding its last visible setting.
alter table public.settings alter column loyalty_earn_rate set default 0;
alter table public.settings alter column loyalty_redemption_value set default 0;

update public.settings set loyalty_earn_rate = 0, loyalty_redemption_value = 0;

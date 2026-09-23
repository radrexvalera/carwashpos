alter table public.settings add column receipt_paper_width text not null default '58mm'
  check (receipt_paper_width in ('58mm', '80mm'));

-- Philippine statutory payroll deductions (SSS/PhilHealth/Pag-IBIG contributions, withholding tax,
-- SSS/HDMF salary loans). Deliberately manual entry, same as base_pay/tips/bonus always have been
-- (0027's own framing: no subsystem exists to compute these from, so direct entry is honest rather
-- than pretending to compute government contribution tables this app doesn't implement).
alter table public.payroll_entries add column withholding_tax numeric(12, 2) not null default 0;
alter table public.payroll_entries add column sss_contribution numeric(12, 2) not null default 0;
alter table public.payroll_entries add column philhealth_contribution numeric(12, 2) not null default 0;
alter table public.payroll_entries add column pagibig_contribution numeric(12, 2) not null default 0;
alter table public.payroll_entries add column sss_loan numeric(12, 2) not null default 0;
alter table public.payroll_entries add column hdmf_loan numeric(12, 2) not null default 0;

-- Generated columns can't have their expression altered in place -- drop and recreate with the six
-- new statutory fields folded in, so the formal PDF payslip's NET PAY always matches the same
-- net_pay shown everywhere else (the payroll table, the thermal payslip).
alter table public.payroll_entries drop column net_pay;
alter table public.payroll_entries add column net_pay numeric(12, 2) generated always as
  (base_pay + commission_total + tips + bonus + adjustments - cash_advance - deductions
   - withholding_tax - sss_contribution - philhealth_contribution - pagibig_contribution - sss_loan - hdmf_loan) stored;

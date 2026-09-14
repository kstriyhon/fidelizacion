-- Agregar campos de fecha de nacimiento (mes y día) a loyalty_members
alter table public.loyalty_members
  add column if not exists birth_month int check (birth_month is null or (birth_month >= 1 and birth_month <= 12)),
  add column if not exists birth_day int check (birth_day is null or (birth_day >= 1 and birth_day <= 31));

-- ============================================================================
-- Fleet Settlement App — schema, RLS, and signup provisioning
-- Run this in the Supabase SQL editor (one shot). Safe to re-run.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- Tenancy ----------
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Fleet',
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'owner' check (role in ('owner','admin','manager','viewer')),
  created_at timestamptz not null default now()
);

-- Returns the caller's organization. Used by every RLS policy.
create or replace function current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from profiles where id = auth.uid()
$$;

-- On signup: create an org and a profile so the user is immediately usable.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org uuid;
begin
  insert into organizations (name) values ('My Fleet') returning id into new_org;
  insert into profiles (id, organization_id, email, full_name, role)
  values (new.id, new_org, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'owner');
  insert into settings (organization_id) values (new_org) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- Reference data ----------
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  scac text,
  mc_number text,
  usdot_number text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists external_carriers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  default_commission numeric default 250,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  full_name text not null,
  type text not null default 'company_driver'
    check (type in ('company_driver','owner_operator','investor','external_carrier_driver')),
  phone text,
  email text,
  default_pay_pct numeric,            -- 0.33 etc (driver default rate)
  default_insurance_deduction numeric default 0,
  default_eld_ifta_deduction numeric default 0,
  status text not null default 'active' check (status in ('active','inactive')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  unit_number text not null,
  vehicle_type text not null default 'truck'
    check (vehicle_type in ('truck','box_truck','hotshot','trailer','other')),
  ownership_type text not null default 'company_owned'
    check (ownership_type in ('company_owned','owner_operator','investor_managed','external_carrier_statement','partner_carrier')),
  company_id uuid references companies (id) on delete set null,
  external_carrier_id uuid references external_carriers (id) on delete set null,
  owner_id uuid references people (id) on delete set null,         -- owner/investor
  assigned_driver_id uuid references people (id) on delete set null,
  -- Settlement config (the heart of flexibility) --
  default_driver_pay_pct numeric,        -- 0.33
  company_fee_pct numeric default 0,     -- 0.12 / 0.10 / 0
  company_fee_is_our_revenue boolean default true,
  external_carrier_fee_pct numeric default 0,
  management_commission_type text default 'none' check (management_commission_type in ('none','flat','percent')),
  management_commission_amount numeric default 0,
  -- Identity --
  vin text, year int, make text, model text, plate text,
  current_mileage numeric default 0,
  status text not null default 'active' check (status in ('active','in_repair','inactive')),
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- Operations ----------
create table if not exists loads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  load_number text,
  load_source text default 'amazon_relay'
    check (load_source in ('amazon_relay','street_load','broker','dat','direct_customer','other')),
  company_id uuid references companies (id) on delete set null,
  external_carrier_id uuid references external_carriers (id) on delete set null,
  vehicle_id uuid references vehicles (id) on delete set null,
  driver_id uuid references people (id) on delete set null,
  pickup_date date,
  delivery_date date,
  pickup_location text,
  delivery_location text,
  route text,
  gross_amount numeric not null default 0,
  fuel_surcharge numeric default 0,
  loaded_miles numeric default 0,
  empty_miles numeric default 0,
  total_miles numeric default 0,
  status text not null default 'delivered'
    check (status in ('pending','booked','delivered','paid','cancelled','rejected')),
  settlement_id uuid,                 -- set when included in a settlement
  source_file_url text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  date date not null default current_date,
  company_id uuid references companies (id) on delete set null,
  external_carrier_id uuid references external_carriers (id) on delete set null,
  vehicle_id uuid references vehicles (id) on delete set null,
  driver_id uuid references people (id) on delete set null,
  owner_id uuid references people (id) on delete set null,
  category text not null default 'fuel',
  amount numeric not null default 0,
  receipt_url text,
  deduct_from_settlement boolean default true,
  deduct_from_driver boolean default false,
  deduct_from_owner boolean default false,
  deduct_from_investor boolean default false,
  settlement_id uuid,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  settlement_type text not null
    check (settlement_type in ('company_driver','box_truck_driver','owner_operator','managed_investor','external_carrier_statement')),
  company_id uuid references companies (id) on delete set null,
  external_carrier_id uuid references external_carriers (id) on delete set null,
  vehicle_id uuid references vehicles (id) on delete set null,
  driver_id uuid references people (id) on delete set null,
  owner_id uuid references people (id) on delete set null,
  week_start date,
  week_end date,
  -- snapshot of resolved config + computed totals --
  config jsonb,
  gross_revenue numeric default 0,
  total_deductions numeric default 0,
  our_commission_earned numeric default 0,
  net_pay numeric default 0,
  external_net_pay numeric,           -- model 5 input
  status text not null default 'draft'
    check (status in ('draft','pending_review','finalized','paid','void')),
  pdf_url text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists settlement_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  settlement_id uuid not null references settlements (id) on delete cascade,
  key text,
  label_en text,
  label_tr text,
  amount numeric not null default 0,
  is_our_revenue boolean default false,
  sort_order int default 0
);

-- ---------- Telegram import ----------
create table if not exists telegram_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  chat_id text not null,              -- Telegram chat id
  title text,
  vehicle_id uuid references vehicles (id) on delete set null,
  driver_id uuid references people (id) on delete set null,
  company_id uuid references companies (id) on delete set null,
  active boolean default true,
  created_at timestamptz not null default now(),
  unique (organization_id, chat_id)
);

-- One-tap pairing: short-lived single-use codes binding a chat to an org.
create table if not exists telegram_pairing_codes (
  code text primary key,
  organization_id uuid not null references organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  used_at timestamptz
);
alter table telegram_pairing_codes enable row level security;
drop policy if exists telegram_pairing_codes_rw on telegram_pairing_codes;
create policy telegram_pairing_codes_rw on telegram_pairing_codes
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

create table if not exists imported_loads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  telegram_group_id uuid references telegram_groups (id) on delete set null,
  chat_id text,
  message_id text,
  source_type text,                   -- pdf | photo | text
  raw_text text,
  file_url text,
  -- AI-extracted fields --
  extracted jsonb,
  load_number text,
  broker_name text,
  driver_name text,
  pickup_date date,
  pickup_location text,
  delivery_date date,
  delivery_location text,
  total_miles numeric,
  gross_rate numeric,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  created_load_id uuid references loads (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Maintenance ----------
create table if not exists maintenance_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid references vehicles (id) on delete cascade,
  service_type text not null,         -- 'Oil Change', 'PM Service', 'Annual Inspection'...
  interval_type text not null default 'mileage' check (interval_type in ('mileage','date')),
  interval_miles numeric,             -- e.g. 25000
  interval_days int,                  -- date-based
  last_done_mileage numeric default 0,
  last_done_date date,
  active boolean default true,
  created_at timestamptz not null default now()
);

create table if not exists maintenance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid references vehicles (id) on delete cascade,
  rule_id uuid references maintenance_rules (id) on delete set null,
  service_type text,
  performed_date date default current_date,
  mileage numeric,
  cost numeric default 0,
  shop_name text,
  invoice_url text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists vehicle_mileage_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid references vehicles (id) on delete cascade,
  mileage numeric not null,
  logged_at timestamptz not null default now(),
  source text default 'manual'
);

-- ---------- Settings (one row per org) ----------
create table if not exists settings (
  organization_id uuid primary key references organizations (id) on delete cascade,
  default_commission numeric default 250,
  pm_due_soon_miles numeric default 2500,
  repair_warning_amount numeric default 5000,
  fuel_warning_pct numeric default 0.30,
  data jsonb default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- Telegram bot: pending AI commands awaiting confirmation / input ----------
create table if not exists bot_pending_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  chat_id text not null,
  intent text not null,
  payload jsonb not null default '{}',
  step int not null default 0,          -- 0 = awaiting confirmation; >0 = multi-step wizard
  awaiting text,                        -- field name being collected (null = confirmation stage)
  created_at timestamptz not null default now()
);
alter table bot_pending_commands enable row level security;
drop policy if exists bot_pending_commands_rw on bot_pending_commands;
create policy bot_pending_commands_rw on bot_pending_commands
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));
create index if not exists idx_bot_pending_org_chat
  on bot_pending_commands (organization_id, chat_id);

-- ============================================================================
-- Row Level Security: every table is scoped to the caller's organization.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','profiles','companies','external_carriers','people','vehicles',
    'loads','expenses','settlements','settlement_items','telegram_groups',
    'imported_loads','maintenance_rules','maintenance_records','vehicle_mileage_logs','settings'
  ] loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- organizations: caller can see/update only their own org row
drop policy if exists org_rw on organizations;
create policy org_rw on organizations for all
  using (id = current_org_id()) with check (id = current_org_id());

-- profiles: caller sees rows in their org
drop policy if exists profiles_rw on profiles;
create policy profiles_rw on profiles for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());

-- All org-scoped tables: identical policy
do $$
declare t text;
begin
  foreach t in array array[
    'companies','external_carriers','people','vehicles','loads','expenses',
    'settlements','settlement_items','telegram_groups','imported_loads',
    'maintenance_rules','maintenance_records','vehicle_mileage_logs','settings'
  ] loop
    execute format('drop policy if exists %I_rw on %I;', t, t);
    execute format(
      'create policy %I_rw on %I for all using (organization_id = current_org_id()) with check (organization_id = current_org_id());',
      t, t);
  end loop;
end $$;

-- Helpful indexes
create index if not exists idx_loads_org on loads (organization_id, delivery_date);
create index if not exists idx_expenses_org on expenses (organization_id, date);
create index if not exists idx_settlements_org on settlements (organization_id, week_end);
create index if not exists idx_imported_org_status on imported_loads (organization_id, status);
create index if not exists idx_tg_chat on telegram_groups (chat_id);

-- ============================================================================
-- Storage: private bucket for Telegram import files (PDFs / screenshots).
-- Uploads (webhook) and signed URLs (app/api/imports/file) use the service role,
-- so no extra Storage RLS policy is needed. Created here so setup is one-shot.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;


-- ============================================================================
-- Fleet Settlement App - V1 database hardening and performance optimization
-- ============================================================================

-- ---------- RLS policy performance and scope ----------
drop policy if exists org_rw on organizations;
create policy org_rw on organizations
  for all to authenticated
  using (id = (select current_org_id()))
  with check (id = (select current_org_id()));

drop policy if exists profiles_rw on profiles;
create policy profiles_rw on profiles
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

do $$
declare t text;
begin
  foreach t in array array[
    'companies','external_carriers','people','vehicles','loads','expenses',
    'settlements','settlement_items','telegram_groups','imported_loads',
    'maintenance_rules','maintenance_records','vehicle_mileage_logs','settings'
  ] loop
    execute format('drop policy if exists %I_rw on %I;', t, t);
    execute format(
      'create policy %I_rw on %I for all to authenticated using (organization_id = (select current_org_id())) with check (organization_id = (select current_org_id()));',
      t, t
    );
  end loop;
end $$;

revoke execute on function current_org_id() from public, anon;
grant execute on function current_org_id() to authenticated, service_role;

-- ---------- Composite tenant keys for same-org foreign keys ----------
do $$
declare
  t text;
  constraint_name text;
begin
  foreach t in array array[
    'organizations','companies','external_carriers','people','vehicles','loads',
    'expenses','settlements','settlement_items','telegram_groups','imported_loads',
    'maintenance_rules','maintenance_records','vehicle_mileage_logs'
  ] loop
    constraint_name := t || '_org_id_id_key';
    if t = 'organizations' then
      continue;
    end if;
    if not exists (
      select 1 from pg_constraint
      where conname = constraint_name
        and conrelid = format('%I', t)::regclass
    ) then
      execute format('alter table %I add constraint %I unique (organization_id, id);', t, constraint_name);
    end if;
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_org_unit_number_key') then
    alter table vehicles add constraint vehicles_org_unit_number_key unique (organization_id, unit_number);
  end if;
end $$;

-- ---------- Same-organization foreign keys ----------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_org_fk') then
    alter table profiles
      add constraint profiles_org_fk foreign key (organization_id)
      references organizations (id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'companies_org_fk') then
    alter table companies
      add constraint companies_org_fk foreign key (organization_id)
      references organizations (id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'external_carriers_org_fk') then
    alter table external_carriers
      add constraint external_carriers_org_fk foreign key (organization_id)
      references organizations (id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'people_org_fk') then
    alter table people
      add constraint people_org_fk foreign key (organization_id)
      references organizations (id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vehicles_org_fk') then
    alter table vehicles
      add constraint vehicles_org_fk foreign key (organization_id)
      references organizations (id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_company_same_org_fk') then
    alter table vehicles
      add constraint vehicles_company_same_org_fk foreign key (organization_id, company_id)
      references companies (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_carrier_same_org_fk') then
    alter table vehicles
      add constraint vehicles_carrier_same_org_fk foreign key (organization_id, external_carrier_id)
      references external_carriers (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_owner_same_org_fk') then
    alter table vehicles
      add constraint vehicles_owner_same_org_fk foreign key (organization_id, owner_id)
      references people (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_driver_same_org_fk') then
    alter table vehicles
      add constraint vehicles_driver_same_org_fk foreign key (organization_id, assigned_driver_id)
      references people (organization_id, id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'loads_org_fk') then
    alter table loads
      add constraint loads_org_fk foreign key (organization_id)
      references organizations (id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loads_company_same_org_fk') then
    alter table loads
      add constraint loads_company_same_org_fk foreign key (organization_id, company_id)
      references companies (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loads_carrier_same_org_fk') then
    alter table loads
      add constraint loads_carrier_same_org_fk foreign key (organization_id, external_carrier_id)
      references external_carriers (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loads_vehicle_same_org_fk') then
    alter table loads
      add constraint loads_vehicle_same_org_fk foreign key (organization_id, vehicle_id)
      references vehicles (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loads_driver_same_org_fk') then
    alter table loads
      add constraint loads_driver_same_org_fk foreign key (organization_id, driver_id)
      references people (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loads_settlement_same_org_fk') then
    alter table loads
      add constraint loads_settlement_same_org_fk foreign key (organization_id, settlement_id)
      references settlements (organization_id, id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'expenses_org_fk') then
    alter table expenses
      add constraint expenses_org_fk foreign key (organization_id)
      references organizations (id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_company_same_org_fk') then
    alter table expenses
      add constraint expenses_company_same_org_fk foreign key (organization_id, company_id)
      references companies (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_carrier_same_org_fk') then
    alter table expenses
      add constraint expenses_carrier_same_org_fk foreign key (organization_id, external_carrier_id)
      references external_carriers (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_vehicle_same_org_fk') then
    alter table expenses
      add constraint expenses_vehicle_same_org_fk foreign key (organization_id, vehicle_id)
      references vehicles (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_driver_same_org_fk') then
    alter table expenses
      add constraint expenses_driver_same_org_fk foreign key (organization_id, driver_id)
      references people (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_owner_same_org_fk') then
    alter table expenses
      add constraint expenses_owner_same_org_fk foreign key (organization_id, owner_id)
      references people (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_settlement_same_org_fk') then
    alter table expenses
      add constraint expenses_settlement_same_org_fk foreign key (organization_id, settlement_id)
      references settlements (organization_id, id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'settlements_org_fk') then
    alter table settlements
      add constraint settlements_org_fk foreign key (organization_id)
      references organizations (id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settlements_company_same_org_fk') then
    alter table settlements
      add constraint settlements_company_same_org_fk foreign key (organization_id, company_id)
      references companies (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settlements_carrier_same_org_fk') then
    alter table settlements
      add constraint settlements_carrier_same_org_fk foreign key (organization_id, external_carrier_id)
      references external_carriers (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settlements_vehicle_same_org_fk') then
    alter table settlements
      add constraint settlements_vehicle_same_org_fk foreign key (organization_id, vehicle_id)
      references vehicles (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settlements_driver_same_org_fk') then
    alter table settlements
      add constraint settlements_driver_same_org_fk foreign key (organization_id, driver_id)
      references people (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settlements_owner_same_org_fk') then
    alter table settlements
      add constraint settlements_owner_same_org_fk foreign key (organization_id, owner_id)
      references people (organization_id, id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'settlement_items_settlement_same_org_fk') then
    alter table settlement_items
      add constraint settlement_items_settlement_same_org_fk foreign key (organization_id, settlement_id)
      references settlements (organization_id, id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'telegram_groups_vehicle_same_org_fk') then
    alter table telegram_groups
      add constraint telegram_groups_vehicle_same_org_fk foreign key (organization_id, vehicle_id)
      references vehicles (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'telegram_groups_driver_same_org_fk') then
    alter table telegram_groups
      add constraint telegram_groups_driver_same_org_fk foreign key (organization_id, driver_id)
      references people (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'telegram_groups_company_same_org_fk') then
    alter table telegram_groups
      add constraint telegram_groups_company_same_org_fk foreign key (organization_id, company_id)
      references companies (organization_id, id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'imported_loads_group_same_org_fk') then
    alter table imported_loads
      add constraint imported_loads_group_same_org_fk foreign key (organization_id, telegram_group_id)
      references telegram_groups (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'imported_loads_created_load_same_org_fk') then
    alter table imported_loads
      add constraint imported_loads_created_load_same_org_fk foreign key (organization_id, created_load_id)
      references loads (organization_id, id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'maintenance_rules_vehicle_same_org_fk') then
    alter table maintenance_rules
      add constraint maintenance_rules_vehicle_same_org_fk foreign key (organization_id, vehicle_id)
      references vehicles (organization_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'maintenance_records_vehicle_same_org_fk') then
    alter table maintenance_records
      add constraint maintenance_records_vehicle_same_org_fk foreign key (organization_id, vehicle_id)
      references vehicles (organization_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'maintenance_records_rule_same_org_fk') then
    alter table maintenance_records
      add constraint maintenance_records_rule_same_org_fk foreign key (organization_id, rule_id)
      references maintenance_rules (organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicle_mileage_logs_vehicle_same_org_fk') then
    alter table vehicle_mileage_logs
      add constraint vehicle_mileage_logs_vehicle_same_org_fk foreign key (organization_id, vehicle_id)
      references vehicles (organization_id, id) on delete cascade not valid;
  end if;
end $$;

-- ---------- Data quality checks ----------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'people_defaults_nonnegative_chk') then
    alter table people add constraint people_defaults_nonnegative_chk
      check (
        coalesce(default_pay_pct, 0) between 0 and 1
        and coalesce(default_insurance_deduction, 0) >= 0
        and coalesce(default_eld_ifta_deduction, 0) >= 0
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vehicles_settlement_config_chk') then
    alter table vehicles add constraint vehicles_settlement_config_chk
      check (
        coalesce(default_driver_pay_pct, 0) between 0 and 1
        and coalesce(company_fee_pct, 0) between 0 and 1
        and coalesce(external_carrier_fee_pct, 0) between 0 and 1
        and coalesce(management_commission_amount, 0) >= 0
        and coalesce(current_mileage, 0) >= 0
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'loads_amounts_miles_dates_chk') then
    alter table loads add constraint loads_amounts_miles_dates_chk
      check (
        coalesce(gross_amount, 0) >= 0
        and coalesce(fuel_surcharge, 0) >= 0
        and coalesce(loaded_miles, 0) >= 0
        and coalesce(empty_miles, 0) >= 0
        and coalesce(total_miles, 0) >= 0
        and (pickup_date is null or delivery_date is null or delivery_date >= pickup_date)
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'expenses_amount_nonnegative_chk') then
    alter table expenses add constraint expenses_amount_nonnegative_chk
      check (coalesce(amount, 0) >= 0) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'settlements_amounts_dates_chk') then
    alter table settlements add constraint settlements_amounts_dates_chk
      check (
        coalesce(gross_revenue, 0) >= 0
        and coalesce(total_deductions, 0) >= 0
        and coalesce(our_commission_earned, 0) >= 0
        and (external_net_pay is null or external_net_pay >= 0)
        and (week_start is null or week_end is null or week_end >= week_start)
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'imported_loads_amounts_miles_dates_chk') then
    alter table imported_loads add constraint imported_loads_amounts_miles_dates_chk
      check (
        (gross_rate is null or gross_rate >= 0)
        and (total_miles is null or total_miles >= 0)
        and (pickup_date is null or delivery_date is null or delivery_date >= pickup_date)
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'maintenance_rules_intervals_chk') then
    alter table maintenance_rules add constraint maintenance_rules_intervals_chk
      check (
        coalesce(interval_miles, 0) >= 0
        and coalesce(interval_days, 0) >= 0
        and coalesce(last_done_mileage, 0) >= 0
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'maintenance_records_amounts_chk') then
    alter table maintenance_records add constraint maintenance_records_amounts_chk
      check (coalesce(mileage, 0) >= 0 and coalesce(cost, 0) >= 0) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vehicle_mileage_logs_mileage_chk') then
    alter table vehicle_mileage_logs add constraint vehicle_mileage_logs_mileage_chk
      check (mileage >= 0) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'settings_thresholds_chk') then
    alter table settings add constraint settings_thresholds_chk
      check (
        coalesce(default_commission, 0) >= 0
        and coalesce(pm_due_soon_miles, 0) >= 0
        and coalesce(repair_warning_amount, 0) >= 0
        and coalesce(fuel_warning_pct, 0) between 0 and 1
      ) not valid;
  end if;
end $$;

create unique index if not exists imported_loads_org_chat_message_key
  on imported_loads (organization_id, chat_id, message_id)
  where chat_id is not null and message_id is not null;

-- ---------- Query-path and FK indexes ----------
create index if not exists idx_profiles_org on profiles (organization_id);
create index if not exists idx_companies_org_name on companies (organization_id, name);
create index if not exists idx_carriers_org_name on external_carriers (organization_id, name);
create index if not exists idx_people_org_name on people (organization_id, full_name);
create index if not exists idx_people_org_type_name on people (organization_id, type, full_name);
create index if not exists idx_vehicles_org_unit_number on vehicles (organization_id, unit_number);
create index if not exists idx_vehicles_org_status on vehicles (organization_id, status);
create index if not exists idx_vehicles_org_company on vehicles (organization_id, company_id);
create index if not exists idx_vehicles_org_carrier on vehicles (organization_id, external_carrier_id);
create index if not exists idx_vehicles_org_owner on vehicles (organization_id, owner_id);
create index if not exists idx_vehicles_org_driver on vehicles (organization_id, assigned_driver_id);

create index if not exists idx_loads_org_vehicle_delivery_unsettled
  on loads (organization_id, vehicle_id, delivery_date)
  where settlement_id is null and status in ('delivered', 'paid', 'booked');
create index if not exists idx_loads_org_delivery_status on loads (organization_id, delivery_date, status);
create index if not exists idx_loads_org_company on loads (organization_id, company_id);
create index if not exists idx_loads_org_carrier on loads (organization_id, external_carrier_id);
create index if not exists idx_loads_org_driver on loads (organization_id, driver_id);
create index if not exists idx_loads_settlement_id on loads (settlement_id) where settlement_id is not null;

create index if not exists idx_expenses_org_vehicle_date_unsettled
  on expenses (organization_id, vehicle_id, date)
  where settlement_id is null and deduct_from_settlement = true;
create index if not exists idx_expenses_org_date_category on expenses (organization_id, date, category);
create index if not exists idx_expenses_org_company on expenses (organization_id, company_id);
create index if not exists idx_expenses_org_carrier on expenses (organization_id, external_carrier_id);
create index if not exists idx_expenses_org_driver on expenses (organization_id, driver_id);
create index if not exists idx_expenses_org_owner on expenses (organization_id, owner_id);
create index if not exists idx_expenses_settlement_id on expenses (settlement_id) where settlement_id is not null;

create index if not exists idx_settlements_org_created on settlements (organization_id, created_at desc);
create index if not exists idx_settlements_org_status on settlements (organization_id, status);
create index if not exists idx_settlements_org_vehicle_week on settlements (organization_id, vehicle_id, week_start, week_end);
create index if not exists idx_settlements_org_company on settlements (organization_id, company_id);
create index if not exists idx_settlements_org_carrier on settlements (organization_id, external_carrier_id);
create index if not exists idx_settlements_org_driver on settlements (organization_id, driver_id);
create index if not exists idx_settlements_org_owner on settlements (organization_id, owner_id);
create index if not exists idx_settlement_items_settlement_order on settlement_items (settlement_id, sort_order);

create index if not exists idx_tg_org_active_vehicle on telegram_groups (organization_id, active, vehicle_id);
create index if not exists idx_tg_org_driver on telegram_groups (organization_id, driver_id);
create index if not exists idx_tg_org_company on telegram_groups (organization_id, company_id);

create index if not exists idx_imported_org_status_created on imported_loads (organization_id, status, created_at desc);
create index if not exists idx_imported_org_group on imported_loads (organization_id, telegram_group_id);
create index if not exists idx_imported_org_created_load on imported_loads (organization_id, created_load_id);

create index if not exists idx_maintenance_rules_org_active_vehicle on maintenance_rules (organization_id, active, vehicle_id);
create index if not exists idx_maintenance_records_org_vehicle_date on maintenance_records (organization_id, vehicle_id, performed_date desc);
create index if not exists idx_maintenance_records_org_rule on maintenance_records (organization_id, rule_id);
create index if not exists idx_mileage_logs_org_vehicle_logged on vehicle_mileage_logs (organization_id, vehicle_id, logged_at desc);

-- ---------- Settlement lock guards ----------
create or replace function guard_settlement_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('finalized', 'paid') then
      raise exception 'Finalized/Paid settlement cannot be deleted.';
    end if;
    return old;
  end if;

  if old.status = 'paid'
    and new.status is distinct from old.status
    and new.status <> 'void' then
    raise exception 'Paid settlement can only be voided.';
  end if;

  if old.status = 'finalized'
    and new.status is distinct from old.status
    and new.status not in ('paid', 'void') then
    raise exception 'Finalized settlement can only move to paid or void.';
  end if;

  if old.status in ('finalized', 'paid') and (
    new.settlement_type is distinct from old.settlement_type
    or new.company_id is distinct from old.company_id
    or new.external_carrier_id is distinct from old.external_carrier_id
    or new.vehicle_id is distinct from old.vehicle_id
    or new.driver_id is distinct from old.driver_id
    or new.owner_id is distinct from old.owner_id
    or new.week_start is distinct from old.week_start
    or new.week_end is distinct from old.week_end
    or new.config is distinct from old.config
    or new.gross_revenue is distinct from old.gross_revenue
    or new.total_deductions is distinct from old.total_deductions
    or new.our_commission_earned is distinct from old.our_commission_earned
    or new.net_pay is distinct from old.net_pay
    or new.external_net_pay is distinct from old.external_net_pay
  ) then
    raise exception 'Finalized/Paid settlement financial fields cannot be changed.';
  end if;

  return new;
end;
$$;

drop trigger if exists settlements_lock_guard on settlements;
create trigger settlements_lock_guard
  before update or delete on settlements
  for each row execute function guard_settlement_lock();

create or replace function guard_locked_settlement_link()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.settlement_id is not null
    and new.settlement_id is distinct from old.settlement_id
    and exists (
      select 1 from settlements
      where id = old.settlement_id
        and organization_id = old.organization_id
        and status in ('finalized', 'paid')
    ) then
    raise exception 'Rows linked to finalized/paid settlements cannot be moved or detached.';
  end if;
  return new;
end;
$$;

drop trigger if exists loads_locked_settlement_link_guard on loads;
create trigger loads_locked_settlement_link_guard
  before update of settlement_id on loads
  for each row execute function guard_locked_settlement_link();

drop trigger if exists expenses_locked_settlement_link_guard on expenses;
create trigger expenses_locked_settlement_link_guard
  before update of settlement_id on expenses
  for each row execute function guard_locked_settlement_link();

create or replace function guard_locked_settlement_item()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  sid uuid;
  oid uuid;
begin
  if tg_op = 'INSERT' then
    sid := new.settlement_id;
    oid := new.organization_id;
  elsif tg_op = 'DELETE' then
    sid := old.settlement_id;
    oid := old.organization_id;
  else
    sid := coalesce(new.settlement_id, old.settlement_id);
    oid := coalesce(new.organization_id, old.organization_id);
  end if;

  if exists (
    select 1 from settlements
    where id = sid
      and organization_id = oid
      and status in ('finalized', 'paid')
  ) then
    raise exception 'Finalized/Paid settlement items cannot be changed.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists settlement_items_locked_guard on settlement_items;
create trigger settlement_items_locked_guard
  before insert or update or delete on settlement_items
  for each row execute function guard_locked_settlement_item();

-- ---------- Atomic settlement persistence ----------
create or replace function create_settlement_atomic(
  p_settlement_type text,
  p_company_id uuid,
  p_external_carrier_id uuid,
  p_vehicle_id uuid,
  p_driver_id uuid,
  p_owner_id uuid,
  p_week_start date,
  p_week_end date,
  p_config jsonb,
  p_gross_revenue numeric,
  p_total_deductions numeric,
  p_our_commission_earned numeric,
  p_net_pay numeric,
  p_external_net_pay numeric,
  p_line_items jsonb,
  p_load_ids uuid[] default '{}'::uuid[],
  p_expense_ids uuid[] default '{}'::uuid[],
  -- Trusted service-role callers (Telegram bot) have no auth.uid(), so
  -- current_org_id() is null; they pass the org explicitly. Authenticated
  -- callers cannot override their own org (coalesce prefers current_org_id()).
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org_id uuid := coalesce(current_org_id(), p_organization_id);
  v_settlement_id uuid;
  v_expected_loads int := coalesce(array_length(p_load_ids, 1), 0);
  v_expected_expenses int := coalesce(array_length(p_expense_ids, 1), 0);
  v_actual int;
begin
  if v_org_id is null then
    raise exception 'Organization context is required.';
  end if;

  if p_settlement_type not in (
    'company_driver',
    'box_truck_driver',
    'owner_operator',
    'managed_investor',
    'external_carrier_statement'
  ) then
    raise exception 'Invalid settlement type: %', p_settlement_type;
  end if;

  if p_week_start is not null and p_week_end is not null and p_week_end < p_week_start then
    raise exception 'Settlement week_end cannot be before week_start.';
  end if;

  if p_company_id is not null and not exists (
    select 1 from companies where organization_id = v_org_id and id = p_company_id
  ) then raise exception 'Company does not belong to this organization.'; end if;

  if p_external_carrier_id is not null and not exists (
    select 1 from external_carriers where organization_id = v_org_id and id = p_external_carrier_id
  ) then raise exception 'External carrier does not belong to this organization.'; end if;

  if p_vehicle_id is not null and not exists (
    select 1 from vehicles where organization_id = v_org_id and id = p_vehicle_id
  ) then raise exception 'Vehicle does not belong to this organization.'; end if;

  if p_driver_id is not null and not exists (
    select 1 from people where organization_id = v_org_id and id = p_driver_id
  ) then raise exception 'Driver does not belong to this organization.'; end if;

  if p_owner_id is not null and not exists (
    select 1 from people where organization_id = v_org_id and id = p_owner_id
  ) then raise exception 'Owner does not belong to this organization.'; end if;

  if v_expected_loads > 0 then
    perform 1
    from loads
    where organization_id = v_org_id
      and id = any(p_load_ids)
      and settlement_id is null
      and status in ('delivered', 'paid', 'booked')
      and (p_vehicle_id is null or vehicle_id = p_vehicle_id)
      and (p_week_start is null or delivery_date >= p_week_start)
      and (p_week_end is null or delivery_date <= p_week_end)
    order by id
    for update;
    get diagnostics v_actual = row_count;
    if v_actual <> v_expected_loads then
      raise exception 'One or more loads were already settled or no longer match this settlement.';
    end if;
  end if;

  if v_expected_expenses > 0 then
    perform 1
    from expenses
    where organization_id = v_org_id
      and id = any(p_expense_ids)
      and settlement_id is null
      and deduct_from_settlement = true
      and (p_vehicle_id is null or vehicle_id = p_vehicle_id)
      and (p_week_start is null or date >= p_week_start)
      and (p_week_end is null or date <= p_week_end)
    order by id
    for update;
    get diagnostics v_actual = row_count;
    if v_actual <> v_expected_expenses then
      raise exception 'One or more expenses were already settled or no longer match this settlement.';
    end if;
  end if;

  insert into settlements (
    organization_id,
    settlement_type,
    company_id,
    external_carrier_id,
    vehicle_id,
    driver_id,
    owner_id,
    week_start,
    week_end,
    config,
    gross_revenue,
    total_deductions,
    our_commission_earned,
    net_pay,
    external_net_pay,
    status
  ) values (
    v_org_id,
    p_settlement_type,
    p_company_id,
    p_external_carrier_id,
    p_vehicle_id,
    p_driver_id,
    p_owner_id,
    p_week_start,
    p_week_end,
    coalesce(p_config, '{}'::jsonb),
    coalesce(p_gross_revenue, 0),
    coalesce(p_total_deductions, 0),
    coalesce(p_our_commission_earned, 0),
    coalesce(p_net_pay, 0),
    p_external_net_pay,
    'draft'
  )
  returning id into v_settlement_id;

  insert into settlement_items (
    organization_id,
    settlement_id,
    key,
    label_en,
    label_tr,
    amount,
    is_our_revenue,
    sort_order
  )
  select
    v_org_id,
    v_settlement_id,
    item.key,
    item.label_en,
    item.label_tr,
    coalesce(item.amount, 0),
    coalesce(item.is_our_revenue, false),
    coalesce(item.sort_order, item.ord::int - 1)
  from jsonb_to_recordset(coalesce(p_line_items, '[]'::jsonb))
    with ordinality as item(
      key text,
      label_en text,
      label_tr text,
      amount numeric,
      is_our_revenue boolean,
      sort_order int,
      ord bigint
    );

  if v_expected_loads > 0 then
    update loads
    set settlement_id = v_settlement_id
    where organization_id = v_org_id and id = any(p_load_ids);
  end if;

  if v_expected_expenses > 0 then
    update expenses
    set settlement_id = v_settlement_id
    where organization_id = v_org_id and id = any(p_expense_ids);
  end if;

  return v_settlement_id;
end;
$$;

revoke execute on function create_settlement_atomic(
  text, uuid, uuid, uuid, uuid, uuid, date, date, jsonb, numeric, numeric,
  numeric, numeric, numeric, jsonb, uuid[], uuid[], uuid
) from public, anon;
grant execute on function create_settlement_atomic(
  text, uuid, uuid, uuid, uuid, uuid, date, date, jsonb, numeric, numeric,
  numeric, numeric, numeric, jsonb, uuid[], uuid[], uuid
) to authenticated, service_role;

-- ============================================================================
-- Tracking module (mirror of migration 20260627000000_tracking_module.sql)
-- GPS tracking tables, geocoding fields, and RLS. Safe to re-run.
-- ============================================================================

-- ---------- Tracking enums (idempotent) ----------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'tracking_mode') then
    create type tracking_mode as enum (
      'moving','slow_traffic','parking_maneuver','parked_rest',
      'no_active_load','approaching_pickup','approaching_delivery','offline'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'tracking_status') then
    create type tracking_status as enum ('active','completed','cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'risk_score') then
    create type risk_score as enum ('low','medium','high');
  end if;
  if not exists (select 1 from pg_type where typname = 'appointment_status') then
    create type appointment_status as enum ('early','on_time','tight','at_risk','late','unknown');
  end if;
  if not exists (select 1 from pg_type where typname = 'geofence_status') then
    create type geofence_status as enum (
      'en_route_to_pickup','near_pickup','arrived_pickup','departed_pickup',
      'en_route_to_delivery','near_delivery','arrived_delivery','departed_delivery'
    );
  end if;
end $$;

-- ---------- Extend loads with geocoding fields ----------
alter table loads
  add column if not exists pickup_lat double precision,
  add column if not exists pickup_lng double precision,
  add column if not exists delivery_lat double precision,
  add column if not exists delivery_lng double precision,
  add column if not exists geocoded_at timestamptz;

-- ---------- unit_locations — one row per unit (latest position only) ----------
create table if not exists unit_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  unit_id uuid not null references vehicles (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  speed double precision default 0,          -- mph
  heading double precision,                   -- 0-360 degrees
  accuracy double precision,                  -- meters
  altitude double precision,
  tracking_mode tracking_mode not null default 'offline',
  last_update_at timestamptz not null default now(),
  tablet_device_id text,
  created_at timestamptz not null default now(),
  unique (organization_id, unit_id)
);
create index if not exists unit_locations_org_idx on unit_locations (organization_id);
create index if not exists unit_locations_unit_idx on unit_locations (unit_id);
create index if not exists unit_locations_update_idx on unit_locations (last_update_at);

-- ---------- load_tracking — per-load tracking state ----------
create table if not exists load_tracking (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  load_id uuid not null references loads (id) on delete cascade,
  tracking_status tracking_status not null default 'active',
  geofence_status geofence_status not null default 'en_route_to_pickup',
  risk_score risk_score not null default 'low',
  risk_reasons jsonb default '[]'::jsonb,
  appointment_status appointment_status not null default 'unknown',
  eta_minutes integer,
  eta_calculated_at timestamptz,
  distance_history jsonb default '[]'::jsonb,
  consecutive_positions jsonb default '[]'::jsonb,
  parked_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, load_id)
);
create index if not exists load_tracking_org_idx on load_tracking (organization_id);
create index if not exists load_tracking_load_idx on load_tracking (load_id);
create index if not exists load_tracking_status_idx on load_tracking (tracking_status) where tracking_status = 'active';

create or replace function update_load_tracking_timestamp()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists load_tracking_updated_at on load_tracking;
create trigger load_tracking_updated_at
  before update on load_tracking
  for each row execute function update_load_tracking_timestamp();

-- ---------- tracking_events — alerts and geofence events ----------
create table if not exists tracking_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  unit_id uuid references vehicles (id) on delete set null,
  load_id uuid references loads (id) on delete set null,
  event_type text not null check (event_type in (
    'NEAR_PICKUP','ARRIVED_PICKUP','DEPARTED_PICKUP','REST_STARTED','REST_EXTENDED',
    'MOVEMENT_RESUMED','NEAR_DELIVERY','ARRIVED_DELIVERY','DEPARTED_DELIVERY',
    'NO_LOCATION_UPDATE','TABLET_OFFLINE','ROUTE_DEVIATION_WARNING'
  )),
  acknowledged boolean not null default false,
  acknowledged_by uuid references auth.users (id) on delete set null,
  acknowledged_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists tracking_events_org_idx on tracking_events (organization_id);
create index if not exists tracking_events_load_idx on tracking_events (load_id);
create index if not exists tracking_events_unit_idx on tracking_events (unit_id);
create index if not exists tracking_events_ack_idx on tracking_events (acknowledged) where acknowledged = false;
create index if not exists tracking_events_created_idx on tracking_events (created_at desc);
create unique index if not exists tracking_events_once_per_load
  on tracking_events (load_id, event_type)
  where event_type in ('ARRIVED_PICKUP','DEPARTED_PICKUP','ARRIVED_DELIVERY','DEPARTED_DELIVERY');

-- ---------- tablet_tokens — tablet device authentication ----------
create table if not exists tablet_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  unit_id uuid not null references vehicles (id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  device_id text,
  device_label text,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index if not exists tablet_tokens_org_idx on tablet_tokens (organization_id);
create index if not exists tablet_tokens_token_idx on tablet_tokens (token) where is_active = true;
create index if not exists tablet_tokens_unit_idx on tablet_tokens (unit_id);

-- ---------- RLS ----------
alter table unit_locations enable row level security;
drop policy if exists unit_locations_rw on unit_locations;
create policy unit_locations_rw on unit_locations
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

alter table load_tracking enable row level security;
drop policy if exists load_tracking_rw on load_tracking;
create policy load_tracking_rw on load_tracking
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

alter table tracking_events enable row level security;
drop policy if exists tracking_events_rw on tracking_events;
create policy tracking_events_rw on tracking_events
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

alter table tablet_tokens enable row level security;
drop policy if exists tablet_tokens_rw on tablet_tokens;
create policy tablet_tokens_rw on tablet_tokens
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------- Composite org/id unique keys (matches existing pattern) ----------
alter table unit_locations drop constraint if exists unit_locations_org_id_id_key;
alter table unit_locations add constraint unit_locations_org_id_id_key unique (organization_id, id);
alter table load_tracking drop constraint if exists load_tracking_org_id_id_key;
alter table load_tracking add constraint load_tracking_org_id_id_key unique (organization_id, id);
alter table tracking_events drop constraint if exists tracking_events_org_id_id_key;
alter table tracking_events add constraint tracking_events_org_id_id_key unique (organization_id, id);
alter table tablet_tokens drop constraint if exists tablet_tokens_org_id_id_key;
alter table tablet_tokens add constraint tablet_tokens_org_id_id_key unique (organization_id, id);


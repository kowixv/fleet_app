-- ============================================================================
-- Fleet Settlement App ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â schema, RLS, and signup provisioning
-- Run this in the Supabase SQL editor (one shot). Safe to re-run.
-- ============================================================================

create extension if not exists "pgcrypto";

-- Supabase preinstalls pgcrypto into `extensions`; a plain Postgres gets it in `public`
-- from the line above. Keep both reachable so digest()/gen_random_uuid() resolve either way.
set search_path = public, extensions;

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
  vin text, year int, make text, model text, plate text, truck_color text,
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
-- Amazon payment/trip normalization layer.
-- This migration adds normalized source tables only. It does not create loads, expenses,
-- settlement candidates, settlements, fuel tables, or PDF artifacts.

create table if not exists public.amazon_payment_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  file_id uuid not null,
  invoice_number text not null,
  invoice_date date,
  period_start date,
  period_end date,
  payment_date date,
  payment_status text,
  carrier_identifier text,
  summary_total numeric,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  parser_version text not null,
  schema_signature text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_payment_invoices_org_id_id_key unique (organization_id, id),
  constraint amazon_payment_invoices_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_payment_invoices_file_invoice_key unique (organization_id, file_id, invoice_number),
  constraint amazon_payment_invoices_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_payment_invoices_file_same_batch_fk
    foreign key (organization_id, batch_id, file_id)
    references public.amazon_import_files (organization_id, batch_id, id) on delete cascade,
  constraint amazon_payment_invoices_period_check
    check (period_start is null or period_end is null or period_end >= period_start)
);

create table if not exists public.amazon_payment_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  file_id uuid not null,
  raw_row_id uuid,
  invoice_id uuid not null,
  source_row_number int,
  source_fingerprint text not null,
  row_classification text not null
    check (row_classification in ('trip_parent','load_child','standalone_load','non_financial','invalid')),
  trip_id text,
  load_id text,
  start_date date,
  end_date date,
  route_raw text,
  facility_sequence jsonb not null default '[]'::jsonb,
  distance numeric,
  base_amount numeric,
  fuel_surcharge_amount numeric,
  toll_amount numeric,
  detention_amount numeric,
  tonu_amount numeric,
  other_amount numeric,
  gross_amount numeric,
  item_type text,
  status text,
  parse_status text not null default 'parsed'
    check (parse_status in ('pending','parsed','warning','failed','skipped')),
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint amazon_payment_rows_org_id_id_key unique (organization_id, id),
  constraint amazon_payment_rows_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_payment_rows_source_fingerprint_key unique (organization_id, file_id, source_fingerprint),
  constraint amazon_payment_rows_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_payment_rows_file_same_batch_fk
    foreign key (organization_id, batch_id, file_id)
    references public.amazon_import_files (organization_id, batch_id, id) on delete cascade,
  constraint amazon_payment_rows_raw_row_same_batch_fk
    foreign key (organization_id, batch_id, raw_row_id)
    references public.amazon_import_raw_rows (organization_id, batch_id, id) on delete set null (raw_row_id),
  constraint amazon_payment_rows_invoice_same_batch_fk
    foreign key (organization_id, batch_id, invoice_id)
    references public.amazon_payment_invoices (organization_id, batch_id, id) on delete cascade,
  constraint amazon_payment_rows_date_check
    check (start_date is null or end_date is null or end_date >= start_date)
);

create table if not exists public.amazon_trip_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  file_id uuid not null,
  raw_row_id uuid,
  source_row_number int,
  source_fingerprint text not null,
  trip_id text,
  load_id text,
  raw_driver_text text,
  tractor_external_id text,
  operator_type text,
  equipment_type text,
  trip_status text,
  load_status text,
  estimated_distance numeric,
  facility_sequence jsonb not null default '[]'::jsonb,
  stops jsonb not null default '[]'::jsonb,
  planned_first_arrival timestamptz,
  planned_final_departure timestamptz,
  actual_first_arrival timestamptz,
  actual_final_departure timestamptz,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint amazon_trip_rows_org_id_id_key unique (organization_id, id),
  constraint amazon_trip_rows_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_trip_rows_source_fingerprint_key unique (organization_id, file_id, source_fingerprint),
  constraint amazon_trip_rows_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_trip_rows_file_same_batch_fk
    foreign key (organization_id, batch_id, file_id)
    references public.amazon_import_files (organization_id, batch_id, id) on delete cascade,
  constraint amazon_trip_rows_raw_row_same_batch_fk
    foreign key (organization_id, batch_id, raw_row_id)
    references public.amazon_import_raw_rows (organization_id, batch_id, id) on delete set null (raw_row_id)
);

create table if not exists public.amazon_trip_driver_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  trip_row_id uuid not null,
  token_order int not null check (token_order > 0),
  raw_name text not null,
  normalized_name text not null,
  is_team_assignment boolean not null default false,
  requires_split_rule boolean not null default false,
  created_at timestamptz not null default now(),
  constraint amazon_trip_driver_tokens_trip_row_order_key unique (organization_id, trip_row_id, token_order),
  constraint amazon_trip_driver_tokens_trip_row_same_org_fk
    foreign key (organization_id, trip_row_id)
    references public.amazon_trip_rows (organization_id, id) on delete cascade
);

create table if not exists public.amazon_import_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  payment_row_id uuid not null,
  trip_row_id uuid,
  match_type text not null,
  match_method text not null
    check (match_method in ('exact_load_id','exact_trip_id','vehicle_period_facility','manual')),
  confidence_score numeric not null check (confidence_score >= 0 and confidence_score <= 1),
  status text not null
    check (status in ('exact','inferred','ambiguous','unmatched','manually_approved','rejected')),
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_import_matches_org_id_id_key unique (organization_id, id),
  constraint amazon_import_matches_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_import_matches_payment_same_batch_fk
    foreign key (organization_id, batch_id, payment_row_id)
    references public.amazon_payment_rows (organization_id, batch_id, id) on delete cascade,
  constraint amazon_import_matches_trip_same_batch_fk
    foreign key (organization_id, batch_id, trip_row_id)
    references public.amazon_trip_rows (organization_id, batch_id, id) on delete set null (trip_row_id)
);

create unique index if not exists amazon_import_matches_one_active_approved_key
  on public.amazon_import_matches (organization_id, payment_row_id)
  where status in ('exact','inferred','manually_approved');

create table if not exists public.amazon_revenue_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  invoice_id uuid not null,
  grouping_type text not null check (grouping_type in ('trip','load')),
  grouping_key text not null,
  trip_id text,
  primary_load_id text,
  start_date date,
  end_date date,
  origin_facility_code text,
  destination_facility_code text,
  route_resolution_status text not null default 'unresolved'
    check (route_resolution_status in ('resolved','unresolved','not_applicable')),
  distance numeric,
  base_amount numeric not null default 0,
  fuel_surcharge_amount numeric not null default 0,
  toll_amount numeric not null default 0,
  detention_amount numeric not null default 0,
  tonu_amount numeric not null default 0,
  other_amount numeric not null default 0,
  gross_amount numeric not null default 0,
  match_status text not null,
  driver_assignment_status text not null,
  vehicle_assignment_status text not null,
  reconciliation_status text not null
    check (reconciliation_status in ('pending','passed','warning','failed')),
  source_revision text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_revenue_items_org_id_id_key unique (organization_id, id),
  constraint amazon_revenue_items_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_revenue_items_grouping_key unique (organization_id, invoice_id, grouping_key),
  constraint amazon_revenue_items_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_revenue_items_invoice_same_batch_fk
    foreign key (organization_id, batch_id, invoice_id)
    references public.amazon_payment_invoices (organization_id, batch_id, id) on delete cascade,
  constraint amazon_revenue_items_date_check
    check (start_date is null or end_date is null or end_date >= start_date)
);

create table if not exists public.amazon_revenue_item_sources (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  revenue_item_id uuid not null,
  payment_row_id uuid not null,
  contribution_type text not null
    check (contribution_type in ('parent_base','child_accessorial','standalone','other')),
  created_at timestamptz not null default now(),
  primary key (organization_id, revenue_item_id, payment_row_id),
  constraint amazon_revenue_item_sources_revenue_item_same_org_fk
    foreign key (organization_id, revenue_item_id)
    references public.amazon_revenue_items (organization_id, id) on delete cascade,
  constraint amazon_revenue_item_sources_payment_row_same_batch_fk
    foreign key (organization_id, payment_row_id)
    references public.amazon_payment_rows (organization_id, id) on delete cascade
);

create unique index if not exists amazon_revenue_item_sources_one_active_contribution_key
  on public.amazon_revenue_item_sources (organization_id, payment_row_id);

create or replace function public.guard_amazon_payment_invoice_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.amazon_revenue_items ri
    where ri.organization_id = old.organization_id
      and ri.invoice_id = old.id
  ) and (
    new.batch_id is distinct from old.batch_id
    or new.file_id is distinct from old.file_id
    or new.invoice_number is distinct from old.invoice_number
    or new.summary_total is distinct from old.summary_total
    or new.parser_version is distinct from old.parser_version
    or new.schema_signature is distinct from old.schema_signature
    or new.source_snapshot is distinct from old.source_snapshot
  ) then
    raise exception 'Amazon payment invoice source facts cannot be changed after revenue items depend on them.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_amazon_payment_row_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.amazon_revenue_item_sources ris
    where ris.organization_id = old.organization_id
      and ris.payment_row_id = old.id
  ) and (
    new.batch_id is distinct from old.batch_id
    or new.file_id is distinct from old.file_id
    or new.raw_row_id is distinct from old.raw_row_id
    or new.invoice_id is distinct from old.invoice_id
    or new.source_row_number is distinct from old.source_row_number
    or new.source_fingerprint is distinct from old.source_fingerprint
    or new.row_classification is distinct from old.row_classification
    or new.trip_id is distinct from old.trip_id
    or new.load_id is distinct from old.load_id
    or new.base_amount is distinct from old.base_amount
    or new.fuel_surcharge_amount is distinct from old.fuel_surcharge_amount
    or new.toll_amount is distinct from old.toll_amount
    or new.detention_amount is distinct from old.detention_amount
    or new.tonu_amount is distinct from old.tonu_amount
    or new.other_amount is distinct from old.other_amount
    or new.gross_amount is distinct from old.gross_amount
    or new.source_snapshot is distinct from old.source_snapshot
  ) then
    raise exception 'Amazon payment row source facts cannot be changed after revenue items depend on them.';
  end if;
  return new;
end;
$$;

drop trigger if exists amazon_payment_invoices_updated_at on public.amazon_payment_invoices;
create trigger amazon_payment_invoices_updated_at
  before update on public.amazon_payment_invoices
  for each row execute function public.touch_amazon_import_updated_at();

drop trigger if exists amazon_import_matches_updated_at on public.amazon_import_matches;
create trigger amazon_import_matches_updated_at
  before update on public.amazon_import_matches
  for each row execute function public.touch_amazon_import_updated_at();

drop trigger if exists amazon_revenue_items_updated_at on public.amazon_revenue_items;
create trigger amazon_revenue_items_updated_at
  before update on public.amazon_revenue_items
  for each row execute function public.touch_amazon_import_updated_at();

drop trigger if exists amazon_payment_invoices_source_guard on public.amazon_payment_invoices;
create trigger amazon_payment_invoices_source_guard
  before update on public.amazon_payment_invoices
  for each row execute function public.guard_amazon_payment_invoice_source();

drop trigger if exists amazon_payment_rows_source_guard on public.amazon_payment_rows;
create trigger amazon_payment_rows_source_guard
  before update on public.amazon_payment_rows
  for each row execute function public.guard_amazon_payment_row_source();

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_payment_invoices',
    'amazon_payment_rows',
    'amazon_trip_rows',
    'amazon_trip_driver_tokens',
    'amazon_import_matches',
    'amazon_revenue_items',
    'amazon_revenue_item_sources'
  ] loop
    execute format('drop trigger if exists %I_org_guard on public.%I;', t, t);
    execute format(
      'create trigger %I_org_guard before update on public.%I for each row execute function public.guard_amazon_import_organization_id();',
      t, t
    );
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_payment_invoices',
    'amazon_payment_rows',
    'amazon_trip_rows',
    'amazon_trip_driver_tokens',
    'amazon_import_matches',
    'amazon_revenue_items',
    'amazon_revenue_item_sources'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (organization_id = (select public.current_org_id()));',
      t, t
    );
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
      t, t
    );
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer())) with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
      t, t
    );
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
      t, t
    );
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
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return create_settlement_with_links_atomic(
    p_organization_id,
    null,
    p_settlement_type,
    settlement_usage_group(p_settlement_type),
    p_company_id,
    p_external_carrier_id,
    p_vehicle_id,
    p_driver_id,
    p_owner_id,
    p_week_start,
    p_week_end,
    p_config,
    p_gross_revenue,
    p_total_deductions,
    p_our_commission_earned,
    p_net_pay,
    p_external_net_pay,
    p_line_items,
    p_load_ids,
    p_expense_ids
  );
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

-- ---------- unit_locations ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â one row per unit (latest position only) ----------
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

-- ---------- load_tracking ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â per-load tracking state ----------
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

-- ---------- tracking_events ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â alerts and geofence events ----------
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

-- ---------- tablet_tokens ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â tablet device authentication ----------
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


-- =============================================================================
-- 2026-07-03 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Role-aware RLS, hashed tablet tokens, integrity indexes
-- Mirrors: 20260703100000_rls_roles.sql, 20260703100001_tablet_token_hash.sql,
--          20260703100002_constraints_indexes.sql
-- Appended last on purpose: it drops and replaces the permissive %_rw policies
-- defined earlier in this file, so a fresh install ends in the same state as a
-- migrated database.
-- =============================================================================

-- ---------- Role helpers ----------
create or replace function current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

revoke execute on function current_user_role() from public, anon;
grant execute on function current_user_role() to authenticated, service_role;

create or replace function is_org_writer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from profiles where id = auth.uid()) in ('owner','admin','manager'),
    false
  )
$$;

revoke execute on function is_org_writer() from public, anon;
grant execute on function is_org_writer() to authenticated, service_role;

-- ---------- profiles: read-only for members ----------
drop policy if exists profiles_rw on profiles;
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles
  for select to authenticated
  using (organization_id = (select current_org_id()));

-- ---------- organizations: read for members, update for owner/admin ----------
drop policy if exists org_rw on organizations;
drop policy if exists org_select on organizations;
drop policy if exists org_update on organizations;
create policy org_select on organizations
  for select to authenticated
  using (id = (select current_org_id()));
create policy org_update on organizations
  for update to authenticated
  using (id = (select current_org_id()) and (select current_user_role()) in ('owner','admin'))
  with check (id = (select current_org_id()));

-- ---------- All other org tables: select = member, write = writer role ----------
do $$
declare t text;
begin
  foreach t in array array[
    'companies','external_carriers','people','vehicles','loads','expenses',
    'settlements','settlement_items','telegram_groups','imported_loads',
    'maintenance_rules','maintenance_records','vehicle_mileage_logs','settings',
    'telegram_pairing_codes','bot_pending_commands',
    'unit_locations','load_tracking','tracking_events','tablet_tokens'
  ] loop
    execute format('drop policy if exists %I_rw on %I;', t, t);
    execute format('drop policy if exists %I_select on %I;', t, t);
    execute format('drop policy if exists %I_insert on %I;', t, t);
    execute format('drop policy if exists %I_update on %I;', t, t);
    execute format('drop policy if exists %I_delete on %I;', t, t);

    execute format(
      'create policy %I_select on %I for select to authenticated
         using (organization_id = (select current_org_id()));', t, t);
    execute format(
      'create policy %I_insert on %I for insert to authenticated
         with check (organization_id = (select current_org_id()) and (select is_org_writer()));', t, t);
    execute format(
      'create policy %I_update on %I for update to authenticated
         using (organization_id = (select current_org_id()) and (select is_org_writer()))
         with check (organization_id = (select current_org_id()) and (select is_org_writer()));', t, t);
    execute format(
      'create policy %I_delete on %I for delete to authenticated
         using (organization_id = (select current_org_id()) and (select is_org_writer()));', t, t);
  end loop;
end $$;

-- ---------- Tablet tokens: SHA-256 hash instead of plaintext ----------
alter table tablet_tokens add column if not exists token_hash text;

-- Backfill only while the legacy plaintext column still exists (fresh installs
-- and first migration); on an already-migrated DB `token` is gone.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'tablet_tokens' and column_name = 'token') then
    update tablet_tokens
       set token_hash = encode(digest(token, 'sha256'), 'hex')
     where token_hash is null;
  end if;
end $$;

alter table tablet_tokens alter column token_hash set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tablet_tokens_token_hash_key') then
    alter table tablet_tokens add constraint tablet_tokens_token_hash_key unique (token_hash);
  end if;
end $$;

drop index if exists tablet_tokens_token_idx;
create index if not exists tablet_tokens_token_hash_idx
  on tablet_tokens (token_hash) where is_active = true;

alter table tablet_tokens drop column if exists token;

-- ---------- Integrity index + dashboard index ----------
create unique index if not exists imported_loads_created_load_key
  on imported_loads (created_load_id) where created_load_id is not null;

create index if not exists tracking_events_org_created_idx
  on tracking_events (organization_id, created_at desc);

-- =============================================================================
-- 2026-07-12 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Maintenance invoice parsing, atomic writes, history and alerts
-- Mirrors: 20260712000000_maintenance_invoice_upgrade.sql
-- =============================================================================
-- Maintenance invoice import, atomic mileage/service writes, configurable alerts.

alter table settings add column if not exists pm_due_soon_days integer not null default 7;
alter table settings alter column pm_due_soon_miles set default 2000;
update settings set pm_due_soon_miles = 2000 where pm_due_soon_miles = 2500;

alter table maintenance_rules add column if not exists updated_at timestamptz not null default now();
alter table maintenance_records add column if not exists invoice_id uuid;
alter table maintenance_records add column if not exists part_name text;
alter table maintenance_records add column if not exists parts_used text[] not null default '{}'::text[];
alter table maintenance_records add column if not exists next_due_mileage numeric;
alter table maintenance_records add column if not exists next_due_date date;
alter table maintenance_records add column if not exists source text not null default 'manual';
alter table maintenance_records add column if not exists created_by uuid references profiles (id) on delete set null;
alter table maintenance_records add column if not exists updated_at timestamptz not null default now();

create table if not exists maintenance_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid,
  invoice_number text,
  invoice_date date,
  shop_name text,
  file_name text not null,
  storage_path text not null,
  file_hash text not null,
  raw_text text,
  parsed_data jsonb not null default '{}'::jsonb,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint maintenance_invoices_hash_chk check (file_hash ~ '^[a-f0-9]{64}$'),
  constraint maintenance_invoices_org_hash_key unique (organization_id, file_hash),
  constraint maintenance_invoices_org_id_id_key unique (organization_id, id),
  constraint maintenance_invoices_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references vehicles (organization_id, id) on delete set null
);

alter table maintenance_records
  drop constraint if exists maintenance_records_invoice_id_fkey;
alter table maintenance_records
  drop constraint if exists maintenance_records_invoice_same_org_fk;
alter table maintenance_records
  add constraint maintenance_records_invoice_same_org_fk
  foreign key (organization_id, invoice_id)
  references maintenance_invoices (organization_id, id) on delete restrict not valid;

alter table maintenance_rules drop constraint if exists maintenance_rules_interval_shape_chk;
alter table maintenance_rules add constraint maintenance_rules_interval_shape_chk check (
  (interval_type = 'mileage' and interval_miles > 0 and interval_days is null)
  or
  (interval_type = 'date' and interval_days > 0 and interval_miles is null)
) not valid;

alter table maintenance_records drop constraint if exists maintenance_records_next_due_chk;
alter table maintenance_records add constraint maintenance_records_next_due_chk check (
  (next_due_mileage is null or next_due_mileage >= 0)
  and (mileage is null or next_due_mileage is null or next_due_mileage > mileage)
  and (performed_date is null or next_due_date is null or next_due_date > performed_date)
) not valid;

alter table settings drop constraint if exists settings_pm_due_soon_days_chk;
alter table settings add constraint settings_pm_due_soon_days_chk
  check (pm_due_soon_days between 1 and 3650) not valid;

with ranked as (
  select id, row_number() over (
    partition by organization_id, vehicle_id, lower(btrim(service_type))
    order by updated_at desc nulls last, created_at desc, id desc
  ) as row_number
  from maintenance_rules
  where active = true and vehicle_id is not null
)
update maintenance_rules set active = false
where id in (select id from ranked where row_number > 1);

create unique index if not exists maintenance_rules_one_active_service_idx
  on maintenance_rules (organization_id, vehicle_id, lower(btrim(service_type)))
  where active = true and vehicle_id is not null;

create index if not exists maintenance_invoices_org_created_idx
  on maintenance_invoices (organization_id, created_at desc);
create index if not exists maintenance_records_invoice_idx
  on maintenance_records (organization_id, invoice_id);

insert into storage.buckets (id, name, public)
values ('maintenance-invoices', 'maintenance-invoices', false)
on conflict (id) do nothing;

alter table maintenance_invoices enable row level security;
drop policy if exists maintenance_invoices_select on maintenance_invoices;
drop policy if exists maintenance_invoices_insert on maintenance_invoices;
drop policy if exists maintenance_invoices_update on maintenance_invoices;
drop policy if exists maintenance_invoices_delete on maintenance_invoices;
create policy maintenance_invoices_select on maintenance_invoices
  for select to authenticated
  using (organization_id = (select current_org_id()));
create policy maintenance_invoices_insert on maintenance_invoices
  for insert to authenticated
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));
create policy maintenance_invoices_update on maintenance_invoices
  for update to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()))
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));
create policy maintenance_invoices_delete on maintenance_invoices
  for delete to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()));

create or replace function touch_maintenance_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists maintenance_rules_updated_at on maintenance_rules;
create trigger maintenance_rules_updated_at
  before update on maintenance_rules
  for each row execute function touch_maintenance_updated_at();
drop trigger if exists maintenance_records_updated_at on maintenance_records;
create trigger maintenance_records_updated_at
  before update on maintenance_records
  for each row execute function touch_maintenance_updated_at();

-- Atomic odometer write. Authenticated callers are scoped to their org; service-role
-- callers (Telegram) must pass p_organization_id explicitly.
create or replace function set_vehicle_mileage(
  p_vehicle_id uuid,
  p_mileage numeric,
  p_source text default 'manual',
  p_organization_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_current numeric;
begin
  if p_mileage is null or p_mileage < 0 or p_mileage <> trunc(p_mileage) then
    raise exception 'Mileage must be a non-negative whole number.';
  end if;

  v_org := coalesce((select current_org_id()), p_organization_id);
  if v_org is null then raise exception 'Organization is required.'; end if;
  if auth.uid() is not null and not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;

  select current_mileage into v_current
  from vehicles
  where id = p_vehicle_id and organization_id = v_org
  for update;
  if not found then raise exception 'Vehicle not found.'; end if;
  if p_mileage < coalesce(v_current, 0) then
    raise exception 'Mileage cannot be lower than the current odometer (%).', coalesce(v_current, 0);
  end if;

  update vehicles set current_mileage = p_mileage
  where id = p_vehicle_id and organization_id = v_org;

  insert into vehicle_mileage_logs (organization_id, vehicle_id, mileage, source)
  values (v_org, p_vehicle_id, p_mileage, coalesce(nullif(btrim(p_source), ''), 'manual'));

  return p_mileage;
end;
$$;
revoke execute on function set_vehicle_mileage(uuid,numeric,text,uuid) from public, anon;
grant execute on function set_vehicle_mileage(uuid,numeric,text,uuid) to authenticated, service_role;

-- Atomic and idempotent "serviced now" action. Mileage is always re-read from the
-- vehicle row, never trusted from stale browser props.
create or replace function mark_maintenance_serviced(
  p_rule_id uuid,
  p_performed_date date,
  p_cost numeric default 0,
  p_shop_name text default null,
  p_part_name text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_vehicle uuid;
  v_service text;
  v_mileage numeric;
  v_existing uuid;
  v_record uuid;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if p_performed_date is null then raise exception 'Performed date is required.'; end if;
  if coalesce(p_cost, 0) < 0 then raise exception 'Cost cannot be negative.'; end if;

  select r.vehicle_id, r.service_type, v.current_mileage
    into v_vehicle, v_service, v_mileage
  from maintenance_rules r
  join vehicles v on v.id = r.vehicle_id and v.organization_id = r.organization_id
  where r.id = p_rule_id and r.organization_id = v_org and r.active = true
  for update of r, v;
  if not found then raise exception 'Active maintenance rule not found.'; end if;

  select id into v_existing
  from maintenance_records
  where organization_id = v_org
    and rule_id = p_rule_id
    and performed_date = p_performed_date
    and mileage = v_mileage
    and source = 'manual'
  limit 1;
  if v_existing is not null then return v_existing; end if;

  update maintenance_rules
  set last_done_mileage = v_mileage, last_done_date = p_performed_date
  where id = p_rule_id and organization_id = v_org;

  insert into maintenance_records (
    organization_id, vehicle_id, rule_id, service_type, performed_date,
    mileage, cost, shop_name, part_name, notes, source, created_by
  ) values (
    v_org, v_vehicle, p_rule_id, v_service, p_performed_date,
    v_mileage, coalesce(p_cost, 0), nullif(btrim(p_shop_name), ''),
    nullif(btrim(p_part_name), ''), nullif(btrim(p_notes), ''), 'manual', auth.uid()
  ) returning id into v_record;

  return v_record;
end;
$$;
revoke execute on function mark_maintenance_serviced(uuid,date,numeric,text,text,text) from public, anon;
grant execute on function mark_maintenance_serviced(uuid,date,numeric,text,text,text) to authenticated;

-- One transaction for invoice metadata, all service records, and optional rule updates.
-- Intended for the trusted local CLI; only service_role can execute it.
create or replace function save_maintenance_invoice(
  p_invoice jsonb,
  p_services jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (p_invoice->>'organization_id')::uuid;
  v_invoice uuid;
  v_item jsonb;
  v_vehicle uuid;
  v_service text;
  v_rule uuid;
  v_resolution text;
  v_performed_date date;
  v_mileage numeric;
  v_next_mileage numeric;
  v_next_date date;
  v_parts text[];
  v_interval_type text;
  v_interval_miles numeric;
  v_interval_days integer;
begin
  if v_org is null then raise exception 'organization_id is required.'; end if;
  if jsonb_typeof(p_services) <> 'array' or jsonb_array_length(p_services) = 0 then
    raise exception 'At least one service is required.';
  end if;

  insert into maintenance_invoices (
    organization_id, vehicle_id, invoice_number, invoice_date, shop_name,
    file_name, storage_path, file_hash, raw_text, parsed_data, created_by
  ) values (
    v_org,
    nullif(p_invoice->>'vehicle_id', '')::uuid,
    nullif(btrim(p_invoice->>'invoice_number'), ''),
    nullif(p_invoice->>'invoice_date', '')::date,
    nullif(btrim(p_invoice->>'shop_name'), ''),
    p_invoice->>'file_name',
    p_invoice->>'storage_path',
    p_invoice->>'file_hash',
    p_invoice->>'raw_text',
    coalesce(p_invoice->'parsed_data', '{}'::jsonb),
    nullif(p_invoice->>'created_by', '')::uuid
  ) returning id into v_invoice;

  for v_item in select value from jsonb_array_elements(p_services)
  loop
    v_vehicle := (v_item->>'vehicle_id')::uuid;
    v_service := btrim(v_item->>'service_type');
    v_resolution := coalesce(v_item->>'resolution', 'overwrite');
    v_performed_date := nullif(v_item->>'performed_date', '')::date;
    v_mileage := nullif(v_item->>'mileage', '')::numeric;
    v_next_mileage := nullif(v_item->>'next_due_mileage', '')::numeric;
    v_next_date := nullif(v_item->>'next_due_date', '')::date;
    select coalesce(array_agg(distinct btrim(value)), '{}'::text[])
      into v_parts
    from jsonb_array_elements_text(coalesce(v_item->'parts_used', '[]'::jsonb))
    where btrim(value) <> '';
    if array_length(v_parts, 1) is null and nullif(btrim(v_item->>'part_name'), '') is not null then
      v_parts := array[nullif(btrim(v_item->>'part_name'), '')];
    end if;

    if v_service is null or v_service = '' then raise exception 'service_type is required.'; end if;
    if not exists (select 1 from vehicles where id = v_vehicle and organization_id = v_org) then
      raise exception 'Vehicle does not belong to organization.';
    end if;

    if v_mileage is not null then
      update vehicles
      set current_mileage = v_mileage
      where id = v_vehicle and organization_id = v_org
        and v_mileage > coalesce(current_mileage, 0);
      if found then
        insert into vehicle_mileage_logs (organization_id, vehicle_id, mileage, source)
        values (v_org, v_vehicle, v_mileage, 'invoice');
      end if;
    end if;

    select id into v_rule
    from maintenance_rules
    where organization_id = v_org and vehicle_id = v_vehicle and active = true
      and lower(btrim(service_type)) = lower(v_service)
    limit 1
    for update;

    v_interval_type := null;
    v_interval_miles := null;
    v_interval_days := null;
    if v_next_mileage is not null and v_mileage is not null and v_next_mileage > v_mileage then
      v_interval_type := 'mileage';
      v_interval_miles := v_next_mileage - v_mileage;
    elsif v_next_date is not null and v_performed_date is not null and v_next_date > v_performed_date then
      v_interval_type := 'date';
      v_interval_days := v_next_date - v_performed_date;
    end if;

    if v_rule is null and v_interval_type is not null then
      insert into maintenance_rules (
        organization_id, vehicle_id, service_type, interval_type,
        interval_miles, interval_days, last_done_mileage, last_done_date, active
      ) values (
        v_org, v_vehicle, v_service, v_interval_type,
        v_interval_miles, v_interval_days, v_mileage, v_performed_date, true
      ) returning id into v_rule;
    elsif v_rule is not null and v_resolution = 'overwrite' and v_interval_type is not null then
      update maintenance_rules set
        service_type = v_service,
        interval_type = v_interval_type,
        interval_miles = v_interval_miles,
        interval_days = v_interval_days,
        last_done_mileage = v_mileage,
        last_done_date = v_performed_date,
        active = true
      where id = v_rule and organization_id = v_org;
    end if;

    insert into maintenance_records (
      organization_id, vehicle_id, rule_id, invoice_id, service_type,
      performed_date, mileage, cost, shop_name, part_name, parts_used, notes,
      next_due_mileage, next_due_date, source
    ) values (
      v_org, v_vehicle, v_rule, v_invoice, v_service,
      v_performed_date, v_mileage,
      coalesce(nullif(v_item->>'cost', '')::numeric, 0),
      nullif(btrim(coalesce(v_item->>'shop_name', p_invoice->>'shop_name')), ''),
      nullif(btrim(v_item->>'part_name'), ''),
      coalesce(v_parts, '{}'::text[]),
      nullif(btrim(v_item->>'notes'), ''),
      v_next_mileage, v_next_date, 'invoice'
    );
  end loop;

  return v_invoice;
exception
  when unique_violation then
    if sqlerrm like '%maintenance_invoices_org_hash_key%' then
      raise exception 'DUPLICATE_INVOICE';
    end if;
    raise;
end;
$$;
revoke execute on function save_maintenance_invoice(jsonb,jsonb) from public, anon, authenticated;
grant execute on function save_maintenance_invoice(jsonb,jsonb) to service_role;

-- =============================================================================
-- 2026-07-14 - Settlement workflow hardening
-- Mirrors: 20260714050000_settlement_workflow_hardening.sql
-- =============================================================================

create or replace function settlement_usage_group(p_settlement_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_settlement_type in ('company_driver', 'box_truck_driver') then 'driver'
    when p_settlement_type = 'owner_operator' then 'owner'
    when p_settlement_type = 'managed_investor' then 'investor'
    else null
  end
$$;

create or replace function is_org_writer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from profiles where id = auth.uid()) in ('owner','admin','manager'),
    false
  )
$$;

revoke execute on function is_org_writer() from public, anon;
grant execute on function is_org_writer() to authenticated, service_role;

alter table settlements
  add column if not exists created_by uuid references profiles (id) on delete set null,
  add column if not exists finalized_by uuid references profiles (id) on delete set null,
  add column if not exists finalized_at timestamptz,
  add column if not exists paid_by uuid references profiles (id) on delete set null,
  add column if not exists paid_at timestamptz,
  add column if not exists voided_by uuid references profiles (id) on delete set null,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

create table if not exists settlement_load_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  settlement_id uuid not null,
  load_id uuid not null,
  usage_group text not null check (usage_group in ('driver','owner','investor')),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_reason text,
  constraint settlement_load_links_org_id_id_key unique (organization_id, id),
  constraint settlement_load_links_settlement_same_org_fk
    foreign key (organization_id, settlement_id)
    references settlements (organization_id, id) on delete cascade,
  constraint settlement_load_links_load_same_org_fk
    foreign key (organization_id, load_id)
    references loads (organization_id, id) on delete cascade
);

create table if not exists settlement_expense_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  settlement_id uuid not null,
  expense_id uuid not null,
  usage_group text not null check (usage_group in ('driver','owner','investor')),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_reason text,
  constraint settlement_expense_links_org_id_id_key unique (organization_id, id),
  constraint settlement_expense_links_settlement_same_org_fk
    foreign key (organization_id, settlement_id)
    references settlements (organization_id, id) on delete cascade,
  constraint settlement_expense_links_expense_same_org_fk
    foreign key (organization_id, expense_id)
    references expenses (organization_id, id) on delete cascade
);

do $$
declare conflict jsonb;
begin
  select jsonb_agg(row_to_json(x)) into conflict
  from (
    with legacy as (
      select l.organization_id, l.id as load_id,
        case when settlement_usage_group(s.settlement_type) in ('owner','investor') then 'asset_owner'
             else settlement_usage_group(s.settlement_type)
        end as accounting_lane,
        l.settlement_id
      from loads l
      join settlements s on s.organization_id = l.organization_id and s.id = l.settlement_id
      where l.settlement_id is not null and settlement_usage_group(s.settlement_type) is not null
        and not exists (
          select 1 from settlement_load_links x
          where x.organization_id = l.organization_id
            and x.settlement_id = l.settlement_id
            and x.load_id = l.id
            and x.usage_group = settlement_usage_group(s.settlement_type)
        )
    ),
    existing_links as (
      select organization_id, load_id,
        case when usage_group in ('owner','investor') then 'asset_owner' else usage_group end as accounting_lane,
        settlement_id
      from settlement_load_links
      where released_at is null
    ),
    candidates as (
      select * from legacy
      union all
      select * from existing_links
    )
    select organization_id, load_id, accounting_lane, count(*) as conflicting_rows
    from candidates
    group by organization_id, load_id, accounting_lane
    having count(*) > 1
    limit 20
  ) x;
  if conflict is not null then
    raise exception 'Legacy settlement load links conflict with active accounting lanes before backfill: %', conflict;
  end if;
end $$;

do $$
declare conflict jsonb;
begin
  select jsonb_agg(row_to_json(x)) into conflict
  from (
    with legacy as (
      select e.organization_id, e.id as expense_id,
        case when settlement_usage_group(s.settlement_type) in ('owner','investor') then 'asset_owner'
             else settlement_usage_group(s.settlement_type)
        end as accounting_lane,
        e.settlement_id
      from expenses e
      join settlements s on s.organization_id = e.organization_id and s.id = e.settlement_id
      where e.settlement_id is not null and settlement_usage_group(s.settlement_type) is not null
        and not exists (
          select 1 from settlement_expense_links x
          where x.organization_id = e.organization_id
            and x.settlement_id = e.settlement_id
            and x.expense_id = e.id
            and x.usage_group = settlement_usage_group(s.settlement_type)
        )
    ),
    existing_links as (
      select organization_id, expense_id,
        case when usage_group in ('owner','investor') then 'asset_owner' else usage_group end as accounting_lane,
        settlement_id
      from settlement_expense_links
      where released_at is null
    ),
    candidates as (
      select * from legacy
      union all
      select * from existing_links
    )
    select organization_id, expense_id, accounting_lane, count(*) as conflicting_rows
    from candidates
    group by organization_id, expense_id, accounting_lane
    having count(*) > 1
    limit 20
  ) x;
  if conflict is not null then
    raise exception 'Legacy settlement expense links conflict with active accounting lanes before backfill: %', conflict;
  end if;
end $$;

do $$
declare orphan_rows jsonb;
begin
  select jsonb_agg(row_to_json(x)) into orphan_rows
  from (
    select 'loads' as table_name, l.organization_id, l.id as row_id, l.settlement_id
    from loads l
    where l.settlement_id is not null
      and not exists (select 1 from settlements s where s.organization_id = l.organization_id and s.id = l.settlement_id)
    union all
    select 'expenses' as table_name, e.organization_id, e.id as row_id, e.settlement_id
    from expenses e
    where e.settlement_id is not null
      and not exists (select 1 from settlements s where s.organization_id = e.organization_id and s.id = e.settlement_id)
    limit 20
  ) x;
  if orphan_rows is not null then
    raise exception 'Legacy settlement_id rows reference missing or cross-organization settlements: %', orphan_rows;
  end if;
end $$;

drop index if exists settlement_load_links_active_usage_key;
create unique index settlement_load_links_active_usage_key
  on settlement_load_links (
    organization_id,
    load_id,
    (case when usage_group in ('owner','investor') then 'asset_owner' else usage_group end)
  )
  where released_at is null;
drop index if exists settlement_expense_links_active_usage_key;
create unique index settlement_expense_links_active_usage_key
  on settlement_expense_links (
    organization_id,
    expense_id,
    (case when usage_group in ('owner','investor') then 'asset_owner' else usage_group end)
  )
  where released_at is null;
create index if not exists settlement_load_links_settlement_idx
  on settlement_load_links (organization_id, settlement_id, created_at);
create index if not exists settlement_expense_links_settlement_idx
  on settlement_expense_links (organization_id, settlement_id, created_at);
create unique index if not exists settlements_active_vehicle_payee_period_key
  on settlements (
    organization_id,
    settlement_type,
    coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(driver_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(week_start, '0001-01-01'::date),
    coalesce(week_end, '0001-01-01'::date)
  )
  where status <> 'void' and settlement_type <> 'external_carrier_statement';
drop index if exists settlements_active_external_carrier_period_key;
create unique index settlements_active_external_carrier_period_key
  on settlements (
    organization_id,
    external_carrier_id,
    week_start,
    week_end
  )
  where status <> 'void'
    and settlement_type = 'external_carrier_statement'
    and external_carrier_id is not null
    and week_start is not null
    and week_end is not null;

comment on column loads.settlement_id is
  'Legacy single-settlement pointer retained for compatibility. New settlement creation uses settlement_load_links as the authoritative usage record.';
comment on column expenses.settlement_id is
  'Legacy single-settlement pointer retained for compatibility. New settlement creation uses settlement_expense_links as the authoritative usage record.';

insert into settlement_load_links (organization_id, settlement_id, load_id, usage_group, created_at)
select l.organization_id, l.settlement_id, l.id, settlement_usage_group(s.settlement_type), coalesce(s.created_at, now())
from loads l
join settlements s on s.organization_id = l.organization_id and s.id = l.settlement_id
where l.settlement_id is not null
  and settlement_usage_group(s.settlement_type) is not null
  and not exists (
    select 1 from settlement_load_links x
    where x.organization_id = l.organization_id
      and x.settlement_id = l.settlement_id
      and x.load_id = l.id
      and x.usage_group = settlement_usage_group(s.settlement_type)
  );

insert into settlement_expense_links (organization_id, settlement_id, expense_id, usage_group, created_at)
select e.organization_id, e.settlement_id, e.id, settlement_usage_group(s.settlement_type), coalesce(s.created_at, now())
from expenses e
join settlements s on s.organization_id = e.organization_id and s.id = e.settlement_id
where e.settlement_id is not null
  and settlement_usage_group(s.settlement_type) is not null
  and not exists (
    select 1 from settlement_expense_links x
    where x.organization_id = e.organization_id
      and x.settlement_id = e.settlement_id
      and x.expense_id = e.id
      and x.usage_group = settlement_usage_group(s.settlement_type)
  );

alter table settlement_load_links enable row level security;
alter table settlement_expense_links enable row level security;

create or replace function is_org_profile_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from profiles p
    where p.id = auth.uid()
      and p.organization_id = current_org_id()
      and p.role in ('owner','admin')
  );
$$;
grant execute on function is_org_profile_admin() to authenticated, service_role;

create or replace function guard_profile_security_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.id is distinct from old.id then
    raise exception 'Profile id cannot be changed.';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Profile organization cannot be changed.';
  end if;
  if new.role is distinct from old.role and not is_org_profile_admin() then
    raise exception 'Only organization owners or admins can change profile roles.';
  end if;
  if old.id = auth.uid()
    and old.role not in ('owner','admin')
    and new.role in ('owner','admin') then
    raise exception 'Users cannot promote themselves.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_security_update_guard on profiles;
create trigger profiles_security_update_guard
  before update on profiles
  for each row execute function guard_profile_security_update();

drop policy if exists profiles_rw on profiles;
drop policy if exists profiles_select on profiles;
drop policy if exists profiles_update_self on profiles;
drop policy if exists profiles_update_role_admin on profiles;
create policy profiles_select on profiles
  for select to authenticated
  using (organization_id = (select current_org_id()));
create policy profiles_update_self on profiles
  for update to authenticated
  using (organization_id = (select current_org_id()) and id = auth.uid())
  with check (organization_id = (select current_org_id()) and id = auth.uid());
create policy profiles_update_role_admin on profiles
  for update to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_profile_admin()))
  with check (organization_id = (select current_org_id()) and (select is_org_profile_admin()));

do $$
declare t text;
begin
  foreach t in array array['vehicles','people','settings','companies','external_carriers','loads','expenses'] loop
    execute format('drop policy if exists %I_rw on %I;', t, t);
    execute format('drop policy if exists %I_select on %I;', t, t);
    execute format('drop policy if exists %I_insert on %I;', t, t);
    execute format('drop policy if exists %I_update on %I;', t, t);
    execute format('drop policy if exists %I_delete on %I;', t, t);
    execute format('create policy %I_select on %I for select to authenticated using (organization_id = (select current_org_id()));', t, t);
    execute format('create policy %I_insert on %I for insert to authenticated with check (organization_id = (select current_org_id()) and (select is_org_writer()));', t, t);
    execute format('create policy %I_update on %I for update to authenticated using (organization_id = (select current_org_id()) and (select is_org_writer())) with check (organization_id = (select current_org_id()) and (select is_org_writer()));', t, t);
    execute format('create policy %I_delete on %I for delete to authenticated using (organization_id = (select current_org_id()) and (select is_org_writer()));', t, t);
  end loop;

  foreach t in array array['settlements','settlement_items','settlement_load_links','settlement_expense_links'] loop
    execute format('drop policy if exists %I_rw on %I;', t, t);
    execute format('drop policy if exists %I_select on %I;', t, t);
    execute format('drop policy if exists %I_insert on %I;', t, t);
    execute format('drop policy if exists %I_update on %I;', t, t);
    execute format('drop policy if exists %I_delete on %I;', t, t);
    execute format('create policy %I_select on %I for select to authenticated using (organization_id = (select current_org_id()));', t, t);
    execute format('create policy %I_insert on %I for insert to authenticated with check (organization_id = (select current_org_id()) and (select is_org_writer()));', t, t);
    execute format('create policy %I_update on %I for update to authenticated using (organization_id = (select current_org_id()) and (select is_org_writer())) with check (organization_id = (select current_org_id()) and (select is_org_writer()));', t, t);
    execute format('create policy %I_delete on %I for delete to authenticated using (organization_id = (select current_org_id()) and (select is_org_writer()));', t, t);
  end loop;
end $$;

create or replace function guard_settlement_financial_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'void' and new.status is distinct from old.status then
    raise exception 'Void settlement is terminal.';
  end if;
  if old.status in ('finalized', 'paid', 'void') and (
    new.gross_revenue is distinct from old.gross_revenue
    or new.total_deductions is distinct from old.total_deductions
    or new.our_commission_earned is distinct from old.our_commission_earned
    or new.net_pay is distinct from old.net_pay
    or new.external_net_pay is distinct from old.external_net_pay
    or new.config is distinct from old.config
  ) then
    raise exception 'Finalized/Paid/Void settlement financial data cannot be changed.';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status in ('pending_review','finalized','void'))
    or (old.status = 'pending_review' and new.status in ('draft','finalized','void'))
    or (old.status = 'finalized' and new.status in ('paid','void'))
    or (old.status = 'paid' and new.status = 'void')
  ) then
    raise exception 'Invalid settlement status transition.';
  end if;
  return new;
end;
$$;
drop trigger if exists settlements_financial_lock_guard on settlements;
create trigger settlements_financial_lock_guard
  before update on settlements
  for each row execute function guard_settlement_financial_lock();

create or replace function guard_settlement_link_release()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.released_at is not null and new.released_at is null then
    raise exception 'Released settlement links cannot be reactivated.';
  end if;
  if old.released_at is not null and new.released_at is distinct from old.released_at then
    raise exception 'Released settlement link audit timestamp cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists settlement_load_links_release_guard on settlement_load_links;
create trigger settlement_load_links_release_guard
  before update on settlement_load_links
  for each row execute function guard_settlement_link_release();

drop trigger if exists settlement_expense_links_release_guard on settlement_expense_links;
create trigger settlement_expense_links_release_guard
  before update on settlement_expense_links
  for each row execute function guard_settlement_link_release();

create or replace function create_settlement_with_links_atomic(
  p_organization_id uuid,
  p_created_by uuid,
  p_settlement_type text,
  p_usage_group text,
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
  p_expense_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement_id uuid;
  v_expected_loads int := coalesce(array_length(p_load_ids, 1), 0);
  v_expected_expenses int := coalesce(array_length(p_expense_ids, 1), 0);
  v_actual int;
begin
  if p_organization_id is null then raise exception 'Organization is required.'; end if;
  if p_created_by is not null and not exists (select 1 from profiles where organization_id = p_organization_id and id = p_created_by) then
    raise exception 'Created-by profile does not belong to this organization.';
  end if;
  if p_usage_group is distinct from settlement_usage_group(p_settlement_type) then raise exception 'Invalid settlement usage group.'; end if;
  if p_settlement_type = 'external_carrier_statement' and p_external_carrier_id is null then raise exception 'External carrier is required.'; end if;
  if p_settlement_type <> 'external_carrier_statement' and (p_vehicle_id is null or p_week_start is null or p_week_end is null) then raise exception 'Vehicle and period are required.'; end if;
  if p_week_start is not null and p_week_end is not null and p_week_end < p_week_start then raise exception 'Settlement week_end cannot be before week_start.'; end if;
  if p_settlement_type in ('company_driver','box_truck_driver') and p_driver_id is null then raise exception 'Driver is required.'; end if;
  if p_settlement_type = 'owner_operator' and p_owner_id is null then raise exception 'Owner is required.'; end if;
  if p_settlement_type = 'managed_investor' and p_owner_id is null then raise exception 'Investor is required.'; end if;

  perform pg_advisory_xact_lock(hashtext(p_organization_id::text || ':' || coalesce(p_usage_group, 'external') || ':' || coalesce(p_vehicle_id::text, p_external_carrier_id::text, 'none') || ':' || coalesce(p_week_start::text, 'open') || ':' || coalesce(p_week_end::text, 'open')));

  if p_company_id is not null and not exists (select 1 from companies where organization_id = p_organization_id and id = p_company_id) then raise exception 'Company does not belong to this organization.'; end if;
  if p_external_carrier_id is not null and not exists (select 1 from external_carriers where organization_id = p_organization_id and id = p_external_carrier_id) then raise exception 'External carrier does not belong to this organization.'; end if;
  if p_vehicle_id is not null and not exists (select 1 from vehicles where organization_id = p_organization_id and id = p_vehicle_id) then raise exception 'Vehicle does not belong to this organization.'; end if;
  if p_driver_id is not null and not exists (select 1 from people where organization_id = p_organization_id and id = p_driver_id and type in ('company_driver','external_carrier_driver')) then raise exception 'Driver does not belong to this organization.'; end if;
  if p_settlement_type = 'owner_operator' and not exists (select 1 from people where organization_id = p_organization_id and id = p_owner_id and type = 'owner_operator') then raise exception 'Owner does not belong to this organization.'; end if;
  if p_settlement_type = 'managed_investor' and not exists (select 1 from people where organization_id = p_organization_id and id = p_owner_id and type = 'investor') then raise exception 'Investor does not belong to this organization.'; end if;
  if p_settlement_type = 'box_truck_driver' and not exists (select 1 from vehicles where organization_id = p_organization_id and id = p_vehicle_id and vehicle_type = 'box_truck') then raise exception 'Box truck vehicle is required.'; end if;

  if v_expected_loads > 0 then
    perform 1 from loads
    where organization_id = p_organization_id and id = any(p_load_ids)
      and vehicle_id = p_vehicle_id and delivery_date >= p_week_start and delivery_date <= p_week_end
      and status in ('delivered','paid') and gross_amount >= 0
    order by id for update;
    get diagnostics v_actual = row_count;
    if v_actual <> v_expected_loads then raise exception 'One or more loads are no longer eligible.'; end if;
  end if;
  if v_expected_expenses > 0 then
    perform 1 from expenses
    where organization_id = p_organization_id and id = any(p_expense_ids)
      and vehicle_id = p_vehicle_id and date >= p_week_start and date <= p_week_end
      and deduct_from_settlement = true
      and (
        (p_usage_group = 'driver' and (deduct_from_driver = true or (not deduct_from_driver and not deduct_from_owner and not deduct_from_investor)))
        or (p_usage_group = 'owner' and (deduct_from_owner = true or (not deduct_from_driver and not deduct_from_owner and not deduct_from_investor)))
        or (p_usage_group = 'investor' and (deduct_from_investor = true or (not deduct_from_driver and not deduct_from_owner and not deduct_from_investor)))
      )
    order by id for update;
    get diagnostics v_actual = row_count;
    if v_actual <> v_expected_expenses then raise exception 'One or more expenses are no longer eligible.'; end if;
  end if;

  insert into settlements (
    organization_id, settlement_type, company_id, external_carrier_id, vehicle_id,
    driver_id, owner_id, week_start, week_end, config, gross_revenue,
    total_deductions, our_commission_earned, net_pay, external_net_pay, status, created_by
  ) values (
    p_organization_id, p_settlement_type, p_company_id, p_external_carrier_id, p_vehicle_id,
    p_driver_id, p_owner_id, p_week_start, p_week_end, coalesce(p_config, '{}'::jsonb),
    coalesce(p_gross_revenue, 0), coalesce(p_total_deductions, 0),
    coalesce(p_our_commission_earned, 0), coalesce(p_net_pay, 0), p_external_net_pay, 'draft', p_created_by
  ) returning id into v_settlement_id;

  insert into settlement_items (organization_id, settlement_id, key, label_en, label_tr, amount, is_our_revenue, sort_order)
  select p_organization_id, v_settlement_id, item.key, item.label_en, item.label_tr,
         coalesce(item.amount, 0), coalesce(item.is_our_revenue, false), coalesce(item.sort_order, item.ord::int - 1)
  from jsonb_to_recordset(coalesce(p_line_items, '[]'::jsonb))
    with ordinality as item(key text, label_en text, label_tr text, amount numeric, is_our_revenue boolean, sort_order int, ord bigint);

  if v_expected_loads > 0 then
    insert into settlement_load_links (organization_id, settlement_id, load_id, usage_group)
    select p_organization_id, v_settlement_id, unnest(p_load_ids), p_usage_group;
  end if;
  if v_expected_expenses > 0 then
    insert into settlement_expense_links (organization_id, settlement_id, expense_id, usage_group)
    select p_organization_id, v_settlement_id, unnest(p_expense_ids), p_usage_group;
  end if;
  return v_settlement_id;
end;
$$;

revoke execute on function create_settlement_atomic(
  text, uuid, uuid, uuid, uuid, uuid, date, date, jsonb, numeric, numeric,
  numeric, numeric, numeric, jsonb, uuid[], uuid[], uuid
) from public, anon, authenticated;
grant execute on function create_settlement_atomic(
  text, uuid, uuid, uuid, uuid, uuid, date, date, jsonb, numeric, numeric,
  numeric, numeric, numeric, jsonb, uuid[], uuid[], uuid
) to service_role;
revoke execute on function create_settlement_with_links_atomic(
  uuid, uuid, text, text, uuid, uuid, uuid, uuid, uuid, date, date, jsonb,
  numeric, numeric, numeric, numeric, numeric, jsonb, uuid[], uuid[]
) from public, anon, authenticated;
grant execute on function create_settlement_with_links_atomic(
  uuid, uuid, text, text, uuid, uuid, uuid, uuid, uuid, date, date, jsonb,
  numeric, numeric, numeric, numeric, numeric, jsonb, uuid[], uuid[]
) to service_role;

create or replace function transition_settlement_status(p_settlement_id uuid, p_new_status text, p_void_reason text default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
  v_settlement settlements%rowtype;
begin
  if v_org is null or not (select is_org_writer()) then raise exception 'Writer role is required.'; end if;
  select * into v_settlement from settlements where id = p_settlement_id and organization_id = v_org for update;
  if not found then raise exception 'Settlement not found.'; end if;
  if p_new_status = 'void' and length(btrim(coalesce(p_void_reason, ''))) < 3 then raise exception 'Void reason is required.'; end if;
  if not (
    (v_settlement.status = 'draft' and p_new_status in ('pending_review','finalized','void'))
    or (v_settlement.status = 'pending_review' and p_new_status in ('draft','finalized','void'))
    or (v_settlement.status = 'finalized' and p_new_status in ('paid','void'))
    or (v_settlement.status = 'paid' and p_new_status = 'void')
  ) then raise exception 'Invalid settlement status transition.'; end if;

  update settlements
  set status = p_new_status,
      finalized_by = case when p_new_status = 'finalized' then v_user else finalized_by end,
      finalized_at = case when p_new_status = 'finalized' then now() else finalized_at end,
      paid_by = case when p_new_status = 'paid' then v_user else paid_by end,
      paid_at = case when p_new_status = 'paid' then now() else paid_at end,
      voided_by = case when p_new_status = 'void' then v_user else voided_by end,
      voided_at = case when p_new_status = 'void' then now() else voided_at end,
      void_reason = case when p_new_status = 'void' then btrim(p_void_reason) else void_reason end
  where id = p_settlement_id and organization_id = v_org;

  if p_new_status = 'void' then
    update settlement_load_links set released_at = now(), released_reason = btrim(p_void_reason)
    where organization_id = v_org and settlement_id = p_settlement_id and released_at is null;
    update settlement_expense_links set released_at = now(), released_reason = btrim(p_void_reason)
    where organization_id = v_org and settlement_id = p_settlement_id and released_at is null;
  end if;
end;
$$;
revoke execute on function transition_settlement_status(uuid, text, text) from public, anon;
grant execute on function transition_settlement_status(uuid, text, text) to authenticated;

create or replace function delete_draft_settlement(p_settlement_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_status text;
begin
  if v_org is null or not (select is_org_writer()) then raise exception 'Writer role is required.'; end if;
  select status into v_status from settlements where id = p_settlement_id and organization_id = v_org for update;
  if not found then raise exception 'Settlement not found.'; end if;
  if v_status not in ('draft','pending_review') then raise exception 'Only Draft or Review settlements can be deleted.'; end if;
  delete from settlement_load_links where organization_id = v_org and settlement_id = p_settlement_id;
  delete from settlement_expense_links where organization_id = v_org and settlement_id = p_settlement_id;
  delete from settlement_items where organization_id = v_org and settlement_id = p_settlement_id;
  delete from settlements where organization_id = v_org and id = p_settlement_id;
end;
$$;
revoke execute on function delete_draft_settlement(uuid) from public, anon;
grant execute on function delete_draft_settlement(uuid) to authenticated;


-- ============================================================================
-- Amazon import core foundation only.
-- Parser-specific payment/trip/fuel tables come later; this section must not
-- create settlements, project loads/expenses, or weaken settlement protections.
-- ============================================================================

set search_path = public, extensions;

create extension if not exists "btree_gist" with schema extensions;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_org_id_id_key') then
    alter table public.profiles
      add constraint profiles_org_id_id_key unique (organization_id, id);
  end if;
end $$;

create table if not exists public.amazon_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  period_start date,
  period_end date,
  status text not null default 'uploaded'
    check (status in ('uploaded','parsing','parsed','needs_review','reconciled','ready','failed','archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  parser_bundle_version text,
  notes text,
  constraint amazon_import_batches_org_id_id_key unique (organization_id, id),
  constraint amazon_import_batches_period_check
    check (period_start is null or period_end is null or period_end >= period_start),
  constraint amazon_import_batches_created_by_same_org_fk
    foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete set null (created_by)
);

create table if not exists public.amazon_import_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  source_type text not null
    check (source_type in ('amazon_payment','amazon_trips','fuel_card','statement_reference')),
  original_filename text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256_hash text not null check (sha256_hash ~ '^[a-f0-9]{64}$'),
  parser_name text,
  parser_version text,
  schema_signature text,
  status text not null default 'uploaded'
    check (status in ('uploaded','parsing','parsed','failed','archived')),
  created_at timestamptz not null default now(),
  constraint amazon_import_files_org_id_id_key unique (organization_id, id),
  constraint amazon_import_files_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_import_files_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade
);

create unique index if not exists amazon_import_files_active_hash_key
  on public.amazon_import_files (organization_id, source_type, sha256_hash)
  where status in ('uploaded','parsing','parsed');

create index if not exists amazon_import_files_batch_idx
  on public.amazon_import_files (organization_id, batch_id, created_at);

create table if not exists public.amazon_import_raw_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  file_id uuid not null,
  source_sheet text,
  source_page int,
  source_group text,
  source_row_number int,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  parse_status text not null default 'pending'
    check (parse_status in ('pending','parsed','warning','failed','skipped')),
  parse_warning text,
  created_at timestamptz not null default now(),
  constraint amazon_import_raw_rows_org_id_id_key unique (organization_id, id),
  constraint amazon_import_raw_rows_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_import_raw_rows_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_import_raw_rows_file_same_batch_fk
    foreign key (organization_id, batch_id, file_id)
    references public.amazon_import_files (organization_id, batch_id, id) on delete cascade,
  constraint amazon_import_raw_rows_source_sheet_sentinel_check
    check (source_sheet is null or source_sheet <> '__NULL_SOURCE_SHEET__'),
  constraint amazon_import_raw_rows_source_group_sentinel_check
    check (source_group is null or source_group <> '__NULL_SOURCE_GROUP__'),
  constraint amazon_import_raw_rows_source_page_check
    check (source_page is null or source_page >= 0),
  constraint amazon_import_raw_rows_source_row_number_check
    check (source_row_number is null or source_row_number > 0)
);

create unique index if not exists amazon_import_raw_rows_source_lineage_key
  on public.amazon_import_raw_rows (
    organization_id,
    batch_id,
    file_id,
    coalesce(source_sheet, '__NULL_SOURCE_SHEET__'),
    coalesce(source_page, -2147483648),
    coalesce(source_group, '__NULL_SOURCE_GROUP__'),
    coalesce(source_row_number, -2147483648)
  );

create index if not exists amazon_import_raw_rows_batch_idx
  on public.amazon_import_raw_rows (organization_id, batch_id, created_at);

create table if not exists public.amazon_import_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  file_id uuid,
  raw_row_id uuid,
  issue_code text not null,
  severity text not null check (severity in ('info','warning','blocking')),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  constraint amazon_import_issues_org_id_id_key unique (organization_id, id),
  constraint amazon_import_issues_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_import_issues_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_import_issues_file_same_batch_fk
    foreign key (organization_id, batch_id, file_id)
    references public.amazon_import_files (organization_id, batch_id, id) on delete set null (file_id),
  constraint amazon_import_issues_raw_row_same_org_fk
    foreign key (organization_id, batch_id, raw_row_id)
    references public.amazon_import_raw_rows (organization_id, batch_id, id) on delete set null (raw_row_id),
  constraint amazon_import_issues_resolved_by_same_org_fk
    foreign key (organization_id, resolved_by)
    references public.profiles (organization_id, id) on delete set null (resolved_by),
  constraint amazon_import_issues_resolution_check
    check ((status = 'resolved') = (resolved_at is not null))
);

create index if not exists amazon_import_issues_open_idx
  on public.amazon_import_issues (organization_id, batch_id, severity, created_at)
  where status = 'open';

create table if not exists public.amazon_import_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  reconciliation_type text not null,
  expected_amount numeric,
  actual_amount numeric,
  difference_amount numeric,
  expected_count int,
  actual_count int,
  status text not null default 'pending'
    check (status in ('pending','passed','warning','failed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint amazon_import_reconciliations_org_id_id_key unique (organization_id, id),
  constraint amazon_import_reconciliations_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_import_reconciliations_counts_check
    check (
      (expected_count is null or expected_count >= 0)
      and (actual_count is null or actual_count >= 0)
    )
);

create index if not exists amazon_import_reconciliations_batch_idx
  on public.amazon_import_reconciliations (organization_id, batch_id, reconciliation_type, created_at);

create table if not exists public.amazon_import_review_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  issue_id uuid,
  decision_type text not null,
  previous_value jsonb,
  selected_value jsonb,
  reason text,
  decided_by uuid,
  decided_at timestamptz not null default now(),
  constraint amazon_import_review_decisions_org_id_id_key unique (organization_id, id),
  constraint amazon_import_review_decisions_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_import_review_decisions_issue_same_org_fk
    foreign key (organization_id, batch_id, issue_id)
    references public.amazon_import_issues (organization_id, batch_id, id) on delete set null (issue_id),
  constraint amazon_import_review_decisions_decided_by_same_org_fk
    foreign key (organization_id, decided_by)
    references public.profiles (organization_id, id) on delete set null (decided_by)
);

create index if not exists amazon_import_review_decisions_batch_idx
  on public.amazon_import_review_decisions (organization_id, batch_id, decided_at);

create table if not exists public.amazon_external_vehicle_identifiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vehicle_id uuid not null,
  provider text not null check (provider in ('amazon','octane','manual')),
  identifier_type text not null check (identifier_type in ('tractor_vehicle_id','amazon_unit','fuel_unit','fuel_card')),
  external_value text not null,
  normalized_value text not null,
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_external_vehicle_identifiers_org_id_id_key unique (organization_id, id),
  constraint amazon_external_vehicle_identifiers_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete cascade,
  constraint amazon_external_vehicle_identifiers_effective_range_check
    check (effective_to is null or effective_to > effective_from),
  constraint amazon_external_vehicle_identifiers_normalized_not_blank
    check (length(btrim(normalized_value)) > 0)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'amazon_external_vehicle_identifiers_no_overlap'
      and conrelid = 'public.amazon_external_vehicle_identifiers'::regclass
  ) then
    alter table public.amazon_external_vehicle_identifiers
      add constraint amazon_external_vehicle_identifiers_no_overlap
      exclude using gist (
        organization_id with =,
        provider with =,
        identifier_type with =,
        normalized_value with =,
        daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
      );
  end if;
end $$;

create index if not exists amazon_external_vehicle_identifiers_vehicle_idx
  on public.amazon_external_vehicle_identifiers (organization_id, vehicle_id, provider, identifier_type);

create or replace function public.touch_amazon_import_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.normalize_amazon_external_vehicle_identifier()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.normalized_value := upper(regexp_replace(btrim(coalesce(new.external_value, '')), '\s+', ' ', 'g'));
  if new.normalized_value = '' then
    raise exception 'External vehicle identifier cannot be blank.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_amazon_import_organization_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Amazon import organization_id cannot be changed.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_amazon_import_file_lineage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.amazon_import_raw_rows r
    where r.organization_id = old.organization_id
      and r.file_id = old.id
  ) and (
    new.batch_id is distinct from old.batch_id
    or new.source_type is distinct from old.source_type
    or new.original_filename is distinct from old.original_filename
    or new.storage_path is distinct from old.storage_path
    or new.mime_type is distinct from old.mime_type
    or new.size_bytes is distinct from old.size_bytes
    or new.sha256_hash is distinct from old.sha256_hash
  ) then
    raise exception 'Amazon import file source lineage cannot be changed after raw rows exist.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_amazon_import_raw_row_lineage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.normalized_data <> '{}'::jsonb and (
    new.batch_id is distinct from old.batch_id
    or new.file_id is distinct from old.file_id
    or new.source_sheet is distinct from old.source_sheet
    or new.source_page is distinct from old.source_page
    or new.source_group is distinct from old.source_group
    or new.source_row_number is distinct from old.source_row_number
    or new.raw_data is distinct from old.raw_data
  ) then
    raise exception 'Amazon import raw source lineage cannot be changed after normalized data exists.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_amazon_import_review_decision_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Amazon import review decisions are append-only.';
end;
$$;

drop trigger if exists amazon_import_batches_updated_at on public.amazon_import_batches;
create trigger amazon_import_batches_updated_at
  before update on public.amazon_import_batches
  for each row execute function public.touch_amazon_import_updated_at();

drop trigger if exists amazon_external_vehicle_identifiers_updated_at on public.amazon_external_vehicle_identifiers;
create trigger amazon_external_vehicle_identifiers_updated_at
  before update on public.amazon_external_vehicle_identifiers
  for each row execute function public.touch_amazon_import_updated_at();

drop trigger if exists amazon_external_vehicle_identifiers_normalize on public.amazon_external_vehicle_identifiers;
create trigger amazon_external_vehicle_identifiers_normalize
  before insert or update on public.amazon_external_vehicle_identifiers
  for each row execute function public.normalize_amazon_external_vehicle_identifier();

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_import_batches',
    'amazon_import_files',
    'amazon_import_raw_rows',
    'amazon_import_issues',
    'amazon_import_reconciliations',
    'amazon_import_review_decisions',
    'amazon_external_vehicle_identifiers'
  ] loop
    execute format('drop trigger if exists %I_org_guard on public.%I;', t, t);
    execute format(
      'create trigger %I_org_guard before update on public.%I for each row execute function public.guard_amazon_import_organization_id();',
      t, t
    );
  end loop;
end $$;

drop trigger if exists amazon_import_files_lineage_guard on public.amazon_import_files;
create trigger amazon_import_files_lineage_guard
  before update on public.amazon_import_files
  for each row execute function public.guard_amazon_import_file_lineage();

drop trigger if exists amazon_import_raw_rows_lineage_guard on public.amazon_import_raw_rows;
create trigger amazon_import_raw_rows_lineage_guard
  before update on public.amazon_import_raw_rows
  for each row execute function public.guard_amazon_import_raw_row_lineage();

drop trigger if exists amazon_import_review_decisions_update_guard on public.amazon_import_review_decisions;
create trigger amazon_import_review_decisions_update_guard
  before update on public.amazon_import_review_decisions
  for each row execute function public.guard_amazon_import_review_decision_immutable();

drop trigger if exists amazon_import_review_decisions_delete_guard on public.amazon_import_review_decisions;
create trigger amazon_import_review_decisions_delete_guard
  before delete on public.amazon_import_review_decisions
  for each row execute function public.guard_amazon_import_review_decision_immutable();

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_import_batches',
    'amazon_import_files',
    'amazon_import_raw_rows',
    'amazon_import_issues',
    'amazon_import_reconciliations',
    'amazon_import_review_decisions',
    'amazon_external_vehicle_identifiers'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (organization_id = (select public.current_org_id()));',
      t, t
    );
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
      t, t
    );
    if t <> 'amazon_import_review_decisions' then
      execute format(
        'create policy %I_update on public.%I for update to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer())) with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
        t, t
      );
      execute format(
        'create policy %I_delete on public.%I for delete to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
        t, t
      );
    end if;
  end loop;
end $$;

-- Amazon fuel normalization layer.
-- This migration stores fuel source facts and matching decisions only. It does
-- not project deductions into expenses, create statement candidates, or create settlements.

set search_path = public, extensions;

create table if not exists public.fuel_import_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  file_id uuid not null,
  provider text not null check (provider in ('octane')),
  carrier_identifier text,
  period_start date,
  period_end date,
  generated_at timestamptz,
  reported_transaction_count int check (reported_transaction_count is null or reported_transaction_count >= 0),
  reported_total_amount numeric,
  reported_total_quantity numeric,
  reported_discount_amount numeric,
  parser_name text not null,
  parser_version text not null,
  schema_signature text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_import_reports_org_id_id_key unique (organization_id, id),
  constraint fuel_import_reports_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint fuel_import_reports_file_key unique (organization_id, file_id),
  constraint fuel_import_reports_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint fuel_import_reports_file_same_batch_fk
    foreign key (organization_id, batch_id, file_id)
    references public.amazon_import_files (organization_id, batch_id, id) on delete cascade,
  constraint fuel_import_reports_period_check
    check (period_start is null or period_end is null or period_end >= period_start),
  constraint fuel_import_reports_source_type_check
    check (provider = 'octane')
);

create table if not exists public.fuel_import_card_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  report_id uuid not null,
  source_group_number int not null check (source_group_number > 0),
  card_external_id text,
  card_last_four text,
  driver_label_raw text,
  driver_label_normalized text,
  unit_label_raw text,
  unit_label_normalized text,
  reported_transaction_count int check (reported_transaction_count is null or reported_transaction_count >= 0),
  reported_total_amount numeric,
  reported_total_quantity numeric,
  reported_discount_amount numeric,
  is_placeholder_group boolean not null default false,
  source_page_start int check (source_page_start is null or source_page_start > 0),
  source_page_end int check (source_page_end is null or source_page_end > 0),
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fuel_import_card_groups_org_id_id_key unique (organization_id, id),
  constraint fuel_import_card_groups_report_group_key unique (organization_id, report_id, source_group_number),
  constraint fuel_import_card_groups_report_same_org_fk
    foreign key (organization_id, report_id)
    references public.fuel_import_reports (organization_id, id) on delete cascade,
  constraint fuel_import_card_groups_page_check
    check (source_page_start is null or source_page_end is null or source_page_end >= source_page_start)
);

create table if not exists public.fuel_import_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  report_id uuid not null,
  card_group_id uuid not null,
  source_transaction_fingerprint text not null check (source_transaction_fingerprint ~ '^[a-f0-9]{64}$'),
  transaction_at timestamptz,
  invoice_number text,
  merchant_raw text,
  city_raw text,
  state_raw text,
  odometer_raw text,
  fees_amount numeric,
  source_page int check (source_page is null or source_page > 0),
  source_row_number int check (source_row_number is null or source_row_number > 0),
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fuel_import_transactions_org_id_id_key unique (organization_id, id),
  constraint fuel_import_transactions_org_report_id_id_key unique (organization_id, report_id, id),
  constraint fuel_import_transactions_fingerprint_key unique (organization_id, report_id, source_transaction_fingerprint),
  constraint fuel_import_transactions_report_same_org_fk
    foreign key (organization_id, report_id)
    references public.fuel_import_reports (organization_id, id) on delete cascade,
  constraint fuel_import_transactions_group_same_report_fk
    foreign key (organization_id, card_group_id)
    references public.fuel_import_card_groups (organization_id, id) on delete cascade
);

create table if not exists public.fuel_import_transaction_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  transaction_id uuid not null,
  source_line_order int not null check (source_line_order > 0),
  product_type_raw text,
  product_type_normalized text not null check (product_type_normalized in ('ULSD','DEF','FUEL','FEE','OTHER')),
  quantity numeric,
  retail_unit_price numeric,
  charged_unit_price numeric,
  discount_per_unit numeric,
  discount_amount numeric,
  deal_type text,
  charged_amount numeric,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fuel_import_transaction_lines_org_id_id_key unique (organization_id, id),
  constraint fuel_import_transaction_lines_transaction_order_key unique (organization_id, transaction_id, source_line_order),
  constraint fuel_import_transaction_lines_transaction_same_org_fk
    foreign key (organization_id, transaction_id)
    references public.fuel_import_transactions (organization_id, id) on delete cascade,
  constraint fuel_import_transaction_lines_finite_numeric_check
    check (
      (quantity is null or quantity = quantity)
      and (retail_unit_price is null or retail_unit_price = retail_unit_price)
      and (charged_unit_price is null or charged_unit_price = charged_unit_price)
      and (discount_per_unit is null or discount_per_unit = discount_per_unit)
      and (discount_amount is null or discount_amount = discount_amount)
      and (charged_amount is null or charged_amount = charged_amount)
    )
);

create table if not exists public.fuel_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('octane','manual')),
  external_card_id text not null,
  card_last_four text,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_cards_org_id_id_key unique (organization_id, id),
  constraint fuel_cards_provider_external_key unique (organization_id, provider, external_card_id)
);

create table if not exists public.fuel_card_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  fuel_card_id uuid not null,
  vehicle_id uuid,
  driver_id uuid,
  effective_from date not null,
  effective_to date,
  assignment_source text not null check (assignment_source in ('imported_unresolved','manual','effective_card_assignment')),
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_card_assignments_org_id_id_key unique (organization_id, id),
  constraint fuel_card_assignments_card_same_org_fk
    foreign key (organization_id, fuel_card_id)
    references public.fuel_cards (organization_id, id) on delete cascade,
  constraint fuel_card_assignments_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete set null (vehicle_id),
  constraint fuel_card_assignments_driver_same_org_fk
    foreign key (organization_id, driver_id)
    references public.people (organization_id, id) on delete set null (driver_id),
  constraint fuel_card_assignments_effective_range_check
    check (effective_to is null or effective_to > effective_from),
  constraint fuel_card_assignments_approved_target_check
    check (status <> 'approved' or vehicle_id is not null or driver_id is not null)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fuel_card_assignments_no_approved_overlap'
      and conrelid = 'public.fuel_card_assignments'::regclass
  ) then
    alter table public.fuel_card_assignments
      add constraint fuel_card_assignments_no_approved_overlap
      exclude using gist (
        organization_id with =,
        fuel_card_id with =,
        daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
      )
      where (status = 'approved');
  end if;
end $$;

create table if not exists public.fuel_import_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  card_group_id uuid not null,
  transaction_id uuid,
  fuel_card_id uuid,
  vehicle_id uuid,
  driver_id uuid,
  match_method text not null
    check (match_method in ('effective_card_assignment','exact_card_id','exact_unit_alias','exact_driver_label','manual')),
  confidence_score numeric not null check (confidence_score >= 0 and confidence_score <= 1),
  status text not null
    check (status in ('exact','inferred','ambiguous','unmatched','manually_approved','rejected')),
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_import_matches_org_id_id_key unique (organization_id, id),
  constraint fuel_import_matches_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint fuel_import_matches_group_same_org_fk
    foreign key (organization_id, card_group_id)
    references public.fuel_import_card_groups (organization_id, id) on delete cascade,
  constraint fuel_import_matches_transaction_same_org_fk
    foreign key (organization_id, transaction_id)
    references public.fuel_import_transactions (organization_id, id) on delete set null (transaction_id),
  constraint fuel_import_matches_card_same_org_fk
    foreign key (organization_id, fuel_card_id)
    references public.fuel_cards (organization_id, id) on delete set null (fuel_card_id),
  constraint fuel_import_matches_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete set null (vehicle_id),
  constraint fuel_import_matches_driver_same_org_fk
    foreign key (organization_id, driver_id)
    references public.people (organization_id, id) on delete set null (driver_id)
);

create unique index if not exists fuel_import_matches_one_active_group_key
  on public.fuel_import_matches (organization_id, card_group_id)
  where transaction_id is null and status in ('exact','inferred','manually_approved');

create unique index if not exists fuel_import_matches_one_active_transaction_key
  on public.fuel_import_matches (organization_id, card_group_id, transaction_id)
  where transaction_id is not null and status in ('exact','inferred','manually_approved');

create or replace function public.guard_fuel_import_report_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.fuel_import_transactions t
    where t.organization_id = old.organization_id
      and t.report_id = old.id
  ) and (
    new.batch_id is distinct from old.batch_id
    or new.file_id is distinct from old.file_id
    or new.provider is distinct from old.provider
    or new.carrier_identifier is distinct from old.carrier_identifier
    or new.period_start is distinct from old.period_start
    or new.period_end is distinct from old.period_end
    or new.reported_transaction_count is distinct from old.reported_transaction_count
    or new.reported_total_amount is distinct from old.reported_total_amount
    or new.reported_total_quantity is distinct from old.reported_total_quantity
    or new.reported_discount_amount is distinct from old.reported_discount_amount
    or new.parser_name is distinct from old.parser_name
    or new.parser_version is distinct from old.parser_version
    or new.schema_signature is distinct from old.schema_signature
    or new.source_snapshot is distinct from old.source_snapshot
  ) then
    raise exception 'Fuel import report source facts cannot be changed after transactions exist.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_fuel_import_transaction_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.fuel_import_transaction_lines l
    where l.organization_id = old.organization_id
      and l.transaction_id = old.id
  ) or exists (
    select 1
    from public.fuel_import_matches m
    where m.organization_id = old.organization_id
      and m.transaction_id = old.id
  ) then
    if new.report_id is distinct from old.report_id
      or new.card_group_id is distinct from old.card_group_id
      or new.source_transaction_fingerprint is distinct from old.source_transaction_fingerprint
      or new.transaction_at is distinct from old.transaction_at
      or new.invoice_number is distinct from old.invoice_number
      or new.fees_amount is distinct from old.fees_amount
      or new.source_page is distinct from old.source_page
      or new.source_row_number is distinct from old.source_row_number
      or new.source_snapshot is distinct from old.source_snapshot then
      raise exception 'Fuel import transaction source facts cannot be changed after lines or matches exist.';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'fuel_import_reports',
    'fuel_cards',
    'fuel_card_assignments',
    'fuel_import_matches'
  ] loop
    execute format('drop trigger if exists %I_updated_at on public.%I;', t, t);
    execute format(
      'create trigger %I_updated_at before update on public.%I for each row execute function public.touch_amazon_import_updated_at();',
      t, t
    );
  end loop;
end $$;

drop trigger if exists fuel_import_reports_source_guard on public.fuel_import_reports;
create trigger fuel_import_reports_source_guard
  before update on public.fuel_import_reports
  for each row execute function public.guard_fuel_import_report_source();

drop trigger if exists fuel_import_transactions_source_guard on public.fuel_import_transactions;
create trigger fuel_import_transactions_source_guard
  before update on public.fuel_import_transactions
  for each row execute function public.guard_fuel_import_transaction_source();

do $$
declare t text;
begin
  foreach t in array array[
    'fuel_import_reports',
    'fuel_import_card_groups',
    'fuel_import_transactions',
    'fuel_import_transaction_lines',
    'fuel_cards',
    'fuel_card_assignments',
    'fuel_import_matches'
  ] loop
    execute format('drop trigger if exists %I_org_guard on public.%I;', t, t);
    execute format(
      'create trigger %I_org_guard before update on public.%I for each row execute function public.guard_amazon_import_organization_id();',
      t, t
    );
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (organization_id = (select public.current_org_id()));',
      t, t
    );
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
      t, t
    );
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer())) with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
      t, t
    );
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
      t, t
    );
  end loop;
end $$;

-- Amazon reference resolution foundation.
-- This migration stores approved internal mappings needed before projection. It
-- does not create loads, expenses, statement candidates, settlements, or PDFs.

set search_path = public, extensions;


do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'people_org_id_id_key') then
    alter table public.people
      add constraint people_org_id_id_key unique (organization_id, id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vehicles_org_id_id_key') then
    alter table public.vehicles
      add constraint vehicles_org_id_id_key unique (organization_id, id);
  end if;
end $$;

create table if not exists public.amazon_facility_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('amazon','octane','manual')),
  facility_code text not null,
  normalized_facility_code text not null,
  city text not null,
  state text not null,
  postal_code text,
  country_code text not null default 'US',
  timezone text,
  effective_from date not null,
  effective_to date,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','manually_verified','imported_verified','rejected')),
  source text not null check (source in ('manual','amazon','octane','imported','review_decision')),
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_facility_locations_org_id_id_key unique (organization_id, id),
  constraint amazon_facility_locations_verified_by_same_org_fk
    foreign key (organization_id, verified_by)
    references public.profiles (organization_id, id) on delete set null (verified_by),
  constraint amazon_facility_locations_code_check
    check (btrim(facility_code) <> '' and btrim(normalized_facility_code) <> ''),
  constraint amazon_facility_locations_city_state_check
    check (btrim(city) <> '' and btrim(state) <> ''),
  constraint amazon_facility_locations_effective_range_check
    check (effective_to is null or effective_to > effective_from),
  constraint amazon_facility_locations_verified_metadata_check
    check (
      verification_status not in ('manually_verified','imported_verified')
      or verified_at is not null
    )
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'amazon_facility_locations_no_verified_overlap'
      and conrelid = 'public.amazon_facility_locations'::regclass
  ) then
    alter table public.amazon_facility_locations
      add constraint amazon_facility_locations_no_verified_overlap
      exclude using gist (
        organization_id with =,
        provider with =,
        normalized_facility_code with =,
        daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
      )
      where (verification_status in ('manually_verified','imported_verified'));
  end if;
end $$;

create table if not exists public.amazon_external_driver_identifiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('amazon','octane','manual')),
  identifier_type text not null check (identifier_type in ('driver_display_name','driver_external_id','fuel_driver_label')),
  external_value text not null,
  normalized_value text not null,
  person_id uuid not null,
  effective_from date not null,
  effective_to date,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','archived')),
  confidence_score numeric check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  assignment_source text not null check (assignment_source in ('imported','manual','review_decision')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_external_driver_identifiers_org_id_id_key unique (organization_id, id),
  constraint amazon_external_driver_identifiers_person_same_org_fk
    foreign key (organization_id, person_id)
    references public.people (organization_id, id) on delete cascade,
  constraint amazon_external_driver_identifiers_approved_by_same_org_fk
    foreign key (organization_id, approved_by)
    references public.profiles (organization_id, id) on delete set null (approved_by),
  constraint amazon_external_driver_identifiers_value_check
    check (btrim(external_value) <> '' and btrim(normalized_value) <> ''),
  constraint amazon_external_driver_identifiers_effective_range_check
    check (effective_to is null or effective_to > effective_from),
  constraint amazon_external_driver_identifiers_approval_metadata_check
    check (status <> 'approved' or approved_at is not null)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'amazon_external_driver_identifiers_no_approved_overlap'
      and conrelid = 'public.amazon_external_driver_identifiers'::regclass
  ) then
    alter table public.amazon_external_driver_identifiers
      add constraint amazon_external_driver_identifiers_no_approved_overlap
      exclude using gist (
        organization_id with =,
        provider with =,
        identifier_type with =,
        normalized_value with =,
        daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
      )
      where (status = 'approved');
  end if;
end $$;

create table if not exists public.amazon_team_split_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('amazon','manual')),
  team_key text not null,
  effective_from date not null,
  effective_to date,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','archived')),
  assignment_source text not null check (assignment_source in ('imported','manual','review_decision')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_team_split_rules_org_id_id_key unique (organization_id, id),
  constraint amazon_team_split_rules_approved_by_same_org_fk
    foreign key (organization_id, approved_by)
    references public.profiles (organization_id, id) on delete set null (approved_by),
  constraint amazon_team_split_rules_team_key_check
    check (team_key ~ '^team_[a-f0-9]{24}$'),
  constraint amazon_team_split_rules_effective_range_check
    check (effective_to is null or effective_to > effective_from),
  constraint amazon_team_split_rules_approval_metadata_check
    check (status <> 'approved' or approved_at is not null)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'amazon_team_split_rules_no_approved_overlap'
      and conrelid = 'public.amazon_team_split_rules'::regclass
  ) then
    alter table public.amazon_team_split_rules
      add constraint amazon_team_split_rules_no_approved_overlap
      exclude using gist (
        organization_id with =,
        provider with =,
        team_key with =,
        daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
      )
      where (status = 'approved');
  end if;
end $$;

create table if not exists public.amazon_team_split_rule_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  team_split_rule_id uuid not null,
  person_id uuid not null,
  member_order int not null check (member_order > 0),
  split_basis_points int not null check (split_basis_points > 0 and split_basis_points <= 10000),
  created_at timestamptz not null default now(),
  constraint amazon_team_split_rule_members_org_id_id_key unique (organization_id, id),
  constraint amazon_team_split_rule_members_rule_same_org_fk
    foreign key (organization_id, team_split_rule_id)
    references public.amazon_team_split_rules (organization_id, id) on delete cascade,
  constraint amazon_team_split_rule_members_person_same_org_fk
    foreign key (organization_id, person_id)
    references public.people (organization_id, id) on delete cascade,
  constraint amazon_team_split_rule_members_person_key unique (organization_id, team_split_rule_id, person_id),
  constraint amazon_team_split_rule_members_order_key unique (organization_id, team_split_rule_id, member_order)
);

create or replace function public.guard_amazon_team_split_rule_members_total()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_org uuid;
  v_rule uuid;
  v_status text;
  v_total int;
begin
  v_org := coalesce(new.organization_id, old.organization_id);
  v_rule := coalesce(new.team_split_rule_id, old.team_split_rule_id);

  select status into v_status
  from public.amazon_team_split_rules
  where organization_id = v_org
    and id = v_rule;

  if v_status = 'approved' then
    select coalesce(sum(split_basis_points), 0)::int into v_total
    from public.amazon_team_split_rule_members
    where organization_id = v_org
      and team_split_rule_id = v_rule;

    if v_total <> 10000 then
      raise exception 'Approved Amazon team split members must sum to 10000 basis points.';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.guard_amazon_team_split_rule_approval_total()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_total int;
begin
  if new.status = 'approved' then
    select coalesce(sum(split_basis_points), 0)::int into v_total
    from public.amazon_team_split_rule_members
    where organization_id = new.organization_id
      and team_split_rule_id = new.id;

    if v_total <> 10000 then
      raise exception 'Approved Amazon team split rules require members totaling 10000 basis points.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists amazon_team_split_rule_members_total_guard on public.amazon_team_split_rule_members;
create constraint trigger amazon_team_split_rule_members_total_guard
  after insert or update or delete on public.amazon_team_split_rule_members
  deferrable initially deferred
  for each row execute function public.guard_amazon_team_split_rule_members_total();

drop trigger if exists amazon_team_split_rules_total_guard on public.amazon_team_split_rules;
create constraint trigger amazon_team_split_rules_total_guard
  after insert or update of status on public.amazon_team_split_rules
  deferrable initially deferred
  for each row execute function public.guard_amazon_team_split_rule_approval_total();

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_facility_locations',
    'amazon_external_driver_identifiers',
    'amazon_team_split_rules'
  ] loop
    execute format('drop trigger if exists %I_updated_at on public.%I;', t, t);
    execute format(
      'create trigger %I_updated_at before update on public.%I for each row execute function public.touch_amazon_import_updated_at();',
      t, t
    );
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_facility_locations',
    'amazon_external_driver_identifiers',
    'amazon_team_split_rules',
    'amazon_team_split_rule_members'
  ] loop
    execute format('drop trigger if exists %I_org_guard on public.%I;', t, t);
    execute format(
      'create trigger %I_org_guard before update on public.%I for each row execute function public.guard_amazon_import_organization_id();',
      t, t
    );
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (organization_id = (select public.current_org_id()));',
      t, t
    );
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
      t, t
    );
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer())) with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
      t, t
    );
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
      t, t
    );
  end loop;
end $$;

grant select, insert, update, delete on table
  public.amazon_facility_locations,
  public.amazon_external_driver_identifiers,
  public.amazon_team_split_rules,
  public.amazon_team_split_rule_members
to authenticated, service_role;

-- Amazon controlled projection links.
-- This migration adds authoritative lineage from canonical Amazon source records
-- into the existing public.loads and public.expenses tables. It does not create
-- settlement candidates, settlements, PDFs, or competing operational tables.

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loads_org_id_id_key') then
    alter table public.loads
      add constraint loads_org_id_id_key unique (organization_id, id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'expenses_org_id_id_key') then
    alter table public.expenses
      add constraint expenses_org_id_id_key unique (organization_id, id);
  end if;
end $$;

create table if not exists public.amazon_revenue_load_projections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  revenue_item_id uuid not null,
  load_id uuid not null,
  source_revision text not null,
  source_fingerprint text not null,
  projection_status text not null
    check (projection_status in ('projected','conflict','superseded','archived')),
  projection_snapshot jsonb not null default '{}'::jsonb,
  projected_by uuid,
  projected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_error jsonb,
  constraint amazon_revenue_load_projections_org_id_id_key unique (organization_id, id),
  constraint amazon_revenue_load_projections_revenue_item_same_org_fk
    foreign key (organization_id, batch_id, revenue_item_id)
    references public.amazon_revenue_items (organization_id, batch_id, id) on delete cascade,
  constraint amazon_revenue_load_projections_load_same_org_fk
    foreign key (organization_id, load_id)
    references public.loads (organization_id, id) on delete restrict,
  constraint amazon_revenue_load_projections_projected_by_same_org_fk
    foreign key (organization_id, projected_by)
    references public.profiles (organization_id, id) on delete set null (projected_by),
  constraint amazon_revenue_load_projections_source_fingerprint_check
    check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint amazon_revenue_load_projections_source_revision_check
    check (btrim(source_revision) <> '')
);

create unique index if not exists amazon_revenue_load_projections_active_revenue_item_key
  on public.amazon_revenue_load_projections (organization_id, revenue_item_id)
  where projection_status = 'projected';

create unique index if not exists amazon_revenue_load_projections_active_load_key
  on public.amazon_revenue_load_projections (organization_id, load_id)
  where projection_status = 'projected';

create unique index if not exists amazon_revenue_load_projections_active_fingerprint_key
  on public.amazon_revenue_load_projections (organization_id, batch_id, source_fingerprint)
  where projection_status = 'projected';

create table if not exists public.amazon_fuel_expense_projections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  transaction_line_id uuid not null,
  expense_id uuid not null,
  source_revision text not null,
  source_fingerprint text not null,
  projection_status text not null
    check (projection_status in ('projected','conflict','superseded','archived')),
  projection_snapshot jsonb not null default '{}'::jsonb,
  projected_by uuid,
  projected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_error jsonb,
  constraint amazon_fuel_expense_projections_org_id_id_key unique (organization_id, id),
  constraint amazon_fuel_expense_projections_transaction_line_same_org_fk
    foreign key (organization_id, transaction_line_id)
    references public.fuel_import_transaction_lines (organization_id, id) on delete cascade,
  constraint amazon_fuel_expense_projections_expense_same_org_fk
    foreign key (organization_id, expense_id)
    references public.expenses (organization_id, id) on delete restrict,
  constraint amazon_fuel_expense_projections_projected_by_same_org_fk
    foreign key (organization_id, projected_by)
    references public.profiles (organization_id, id) on delete set null (projected_by),
  constraint amazon_fuel_expense_projections_source_fingerprint_check
    check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint amazon_fuel_expense_projections_source_revision_check
    check (btrim(source_revision) <> '')
);

create unique index if not exists amazon_fuel_expense_projections_active_line_key
  on public.amazon_fuel_expense_projections (organization_id, transaction_line_id)
  where projection_status = 'projected';

create unique index if not exists amazon_fuel_expense_projections_active_expense_key
  on public.amazon_fuel_expense_projections (organization_id, expense_id)
  where projection_status = 'projected';

create unique index if not exists amazon_fuel_expense_projections_active_fingerprint_key
  on public.amazon_fuel_expense_projections (organization_id, batch_id, source_fingerprint)
  where projection_status = 'projected';

create or replace function public.guard_amazon_revenue_load_projection_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.batch_id is distinct from old.batch_id
    or new.revenue_item_id is distinct from old.revenue_item_id
    or new.load_id is distinct from old.load_id
    or new.source_fingerprint is distinct from old.source_fingerprint then
    raise exception 'Amazon revenue load projection identity cannot be changed.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_amazon_fuel_expense_projection_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.batch_id is distinct from old.batch_id
    or new.transaction_line_id is distinct from old.transaction_line_id
    or new.expense_id is distinct from old.expense_id
    or new.source_fingerprint is distinct from old.source_fingerprint then
    raise exception 'Amazon fuel expense projection identity cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists amazon_revenue_load_projections_identity_guard on public.amazon_revenue_load_projections;
create trigger amazon_revenue_load_projections_identity_guard
  before update on public.amazon_revenue_load_projections
  for each row execute function public.guard_amazon_revenue_load_projection_identity();

drop trigger if exists amazon_fuel_expense_projections_identity_guard on public.amazon_fuel_expense_projections;
create trigger amazon_fuel_expense_projections_identity_guard
  before update on public.amazon_fuel_expense_projections
  for each row execute function public.guard_amazon_fuel_expense_projection_identity();

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_revenue_load_projections',
    'amazon_fuel_expense_projections'
  ] loop
    execute format('drop trigger if exists %I_updated_at on public.%I;', t, t);
    execute format(
      'create trigger %I_updated_at before update on public.%I for each row execute function public.touch_amazon_import_updated_at();',
      t, t
    );
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (organization_id = (select public.current_org_id()));',
      t, t
    );
  end loop;
end $$;

grant select on table
  public.amazon_revenue_load_projections,
  public.amazon_fuel_expense_projections
to authenticated, service_role;

grant insert, update, delete on table
  public.amazon_revenue_load_projections,
  public.amazon_fuel_expense_projections
to service_role;

create or replace function public.apply_amazon_revenue_load_projections(
  p_organization_id uuid,
  p_batch_id uuid,
  p_preview_revision text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := coalesce(p_organization_id, (select public.current_org_id()));
  v_user uuid := auth.uid();
  v_preview_revision text;
  v_created int := 0;
  v_unchanged int := 0;
  v_conflicts int := 0;
  v_item jsonb;
  v_existing public.amazon_revenue_load_projections%rowtype;
  v_revenue public.amazon_revenue_items%rowtype;
  v_load_id uuid;
begin
  if v_org is null or not (select public.is_org_writer()) then
    raise exception 'Writer role is required.';
  end if;
  if p_batch_id is null then raise exception 'Batch is required.'; end if;
  if p_preview_revision is null or btrim(p_preview_revision) = '' then raise exception 'Preview revision is required.'; end if;

  perform pg_advisory_xact_lock(hashtext(v_org::text || ':amazon-revenue-projection:' || p_batch_id::text));

  select encode(digest(coalesce(p_items::text, '[]'), 'sha256'), 'hex') into v_preview_revision;
  if v_preview_revision <> p_preview_revision then
    raise exception 'projection_preview_stale';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into v_revenue
    from public.amazon_revenue_items
    where organization_id = v_org
      and batch_id = p_batch_id
      and id = (v_item->>'revenueItemId')::uuid
    for update;
    if not found then raise exception 'Revenue item not found.'; end if;
    if v_revenue.source_revision <> v_item->>'sourceRevision' then
      raise exception 'revenue_projection_revision_conflict';
    end if;

    select * into v_existing
    from public.amazon_revenue_load_projections
    where organization_id = v_org
      and revenue_item_id = (v_item->>'revenueItemId')::uuid
      and projection_status = 'projected'
    for update;

    if found then
      if exists (
        select 1
        from public.settlement_load_links l
        join public.settlements s on s.organization_id = l.organization_id and s.id = l.settlement_id
        where l.organization_id = v_org
          and l.load_id = v_existing.load_id
          and l.released_at is null
          and s.status in ('finalized','paid')
      ) then
        v_conflicts := v_conflicts + 1;
        continue;
      end if;
      if v_existing.source_revision = v_item->>'sourceRevision'
        and v_existing.source_fingerprint = v_item->>'sourceFingerprint' then
        v_unchanged := v_unchanged + 1;
      else
        v_conflicts := v_conflicts + 1;
      end if;
    else
      insert into public.loads (
        organization_id, load_number, load_source, vehicle_id, driver_id,
        pickup_date, delivery_date, pickup_location, delivery_location, route,
        gross_amount, fuel_surcharge, total_miles, status, notes
      ) values (
        v_org,
        nullif(v_item #>> '{load,load_number}', ''),
        'amazon_relay',
        nullif(v_item #>> '{load,vehicle_id}', '')::uuid,
        nullif(v_item #>> '{load,driver_id}', '')::uuid,
        v_revenue.start_date,
        v_revenue.end_date,
        null,
        null,
        null,
        coalesce(v_revenue.gross_amount, 0),
        coalesce(v_revenue.fuel_surcharge_amount, 0),
        coalesce(v_revenue.distance, 0),
        'pending',
        nullif(v_item #>> '{load,notes}', '')
      ) returning id into v_load_id;

      insert into public.amazon_revenue_load_projections (
        organization_id, batch_id, revenue_item_id, load_id, source_revision,
        source_fingerprint, projection_status, projection_snapshot, projected_by
      ) values (
        v_org,
        p_batch_id,
        (v_item->>'revenueItemId')::uuid,
        v_load_id,
        v_item->>'sourceRevision',
        v_item->>'sourceFingerprint',
        'projected',
        v_item,
        v_user
      );
      v_created := v_created + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'unchanged', v_unchanged,
    'skipped', 0,
    'conflicts', v_conflicts
  );
end;
$$;

create or replace function public.apply_amazon_fuel_expense_projections(
  p_organization_id uuid,
  p_batch_id uuid,
  p_preview_revision text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := coalesce(p_organization_id, (select public.current_org_id()));
  v_user uuid := auth.uid();
  v_preview_revision text;
  v_created int := 0;
  v_unchanged int := 0;
  v_conflicts int := 0;
  v_item jsonb;
  v_existing public.amazon_fuel_expense_projections%rowtype;
  v_line public.fuel_import_transaction_lines%rowtype;
  v_transaction public.fuel_import_transactions%rowtype;
  v_expense_id uuid;
begin
  if v_org is null or not (select public.is_org_writer()) then
    raise exception 'Writer role is required.';
  end if;
  if p_batch_id is null then raise exception 'Batch is required.'; end if;
  if p_preview_revision is null or btrim(p_preview_revision) = '' then raise exception 'Preview revision is required.'; end if;

  perform pg_advisory_xact_lock(hashtext(v_org::text || ':amazon-fuel-projection:' || p_batch_id::text));

  select encode(digest(coalesce(p_items::text, '[]'), 'sha256'), 'hex') into v_preview_revision;
  if v_preview_revision <> p_preview_revision then
    raise exception 'projection_preview_stale';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into v_line
    from public.fuel_import_transaction_lines
    where organization_id = v_org
      and id = (v_item->>'transactionLineId')::uuid
    for update;
    if not found then raise exception 'Fuel transaction line not found.'; end if;

    select * into v_transaction
    from public.fuel_import_transactions
    where organization_id = v_org
      and id = v_line.transaction_id
    for update;
    if not found then raise exception 'Fuel transaction not found.'; end if;

    select * into v_existing
    from public.amazon_fuel_expense_projections
    where organization_id = v_org
      and transaction_line_id = (v_item->>'transactionLineId')::uuid
      and projection_status = 'projected'
    for update;

    if found then
      if exists (
        select 1
        from public.settlement_expense_links l
        join public.settlements s on s.organization_id = l.organization_id and s.id = l.settlement_id
        where l.organization_id = v_org
          and l.expense_id = v_existing.expense_id
          and l.released_at is null
          and s.status in ('finalized','paid')
      ) then
        v_conflicts := v_conflicts + 1;
        continue;
      end if;
      if v_existing.source_revision = v_item->>'sourceRevision'
        and v_existing.source_fingerprint = v_item->>'sourceFingerprint' then
        v_unchanged := v_unchanged + 1;
      else
        v_conflicts := v_conflicts + 1;
      end if;
    else
      insert into public.expenses (
        organization_id, date, vehicle_id, driver_id, owner_id, category, amount,
        deduct_from_settlement, deduct_from_driver, deduct_from_owner, deduct_from_investor, notes
      ) values (
        v_org,
        coalesce(v_transaction.transaction_at::date, current_date),
        nullif(v_item #>> '{expense,vehicle_id}', '')::uuid,
        nullif(v_item #>> '{expense,driver_id}', '')::uuid,
        null,
        case
          when v_line.product_type_normalized = 'DEF' then 'def'
          when v_line.product_type_normalized = 'FEE' then 'fees'
          when v_line.product_type_normalized = 'OTHER' then 'other'
          else 'fuel'
        end,
        coalesce(v_line.charged_amount, 0),
        false,
        false,
        false,
        false,
        nullif(v_item #>> '{expense,notes}', '')
      ) returning id into v_expense_id;

      insert into public.amazon_fuel_expense_projections (
        organization_id, batch_id, transaction_line_id, expense_id, source_revision,
        source_fingerprint, projection_status, projection_snapshot, projected_by
      ) values (
        v_org,
        p_batch_id,
        (v_item->>'transactionLineId')::uuid,
        v_expense_id,
        v_item->>'sourceRevision',
        v_item->>'sourceFingerprint',
        'projected',
        v_item,
        v_user
      );
      v_created := v_created + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'unchanged', v_unchanged,
    'skipped', 0,
    'conflicts', v_conflicts
  );
end;
$$;

revoke execute on function public.apply_amazon_revenue_load_projections(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.apply_amazon_revenue_load_projections(uuid, uuid, text, jsonb) to authenticated, service_role;

revoke execute on function public.apply_amazon_fuel_expense_projections(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.apply_amazon_fuel_expense_projections(uuid, uuid, text, jsonb) to authenticated, service_role;

-- Amazon statement candidates.
-- Versioned, reviewable calculation packages that select canonical Amazon source
-- records and projected loads/expenses without consuming settlement links.

create table if not exists public.amazon_statement_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  statement_type text not null
    check (statement_type in ('company_driver','box_truck_driver','owner_operator','managed_investor')),
  status text not null default 'draft'
    check (status in ('draft','needs_review','ready','stale','converted','archived')),
  period_start date not null,
  period_end date not null,
  payee_type text not null
    check (payee_type in ('driver','owner','investor')),
  payee_id uuid,
  vehicle_id uuid,
  team_split_rule_id uuid,
  calculation_rule_version text not null,
  template_version text not null,
  source_revision text not null,
  preview_revision text not null,
  configuration_snapshot jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  gross_amount numeric not null default 0,
  percentage_deductions_amount numeric not null default 0,
  fixed_deductions_amount numeric not null default 0,
  fuel_deductions_amount numeric not null default 0,
  other_deductions_amount numeric not null default 0,
  total_deductions_amount numeric not null default 0,
  net_amount numeric not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  converted_settlement_id uuid,
  converted_at timestamptz,
  last_error jsonb,
  constraint amazon_statement_candidates_org_id_id_key unique (organization_id, id),
  constraint amazon_statement_candidates_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_statement_candidates_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_statement_candidates_payee_same_org_fk
    foreign key (organization_id, payee_id)
    references public.people (organization_id, id) on delete restrict,
  constraint amazon_statement_candidates_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint amazon_statement_candidates_team_split_same_org_fk
    foreign key (organization_id, team_split_rule_id)
    references public.amazon_team_split_rules (organization_id, id) on delete restrict,
  constraint amazon_statement_candidates_created_by_same_org_fk
    foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete set null (created_by),
  constraint amazon_statement_candidates_approved_by_same_org_fk
    foreign key (organization_id, approved_by)
    references public.profiles (organization_id, id) on delete set null (approved_by),
  constraint amazon_statement_candidates_settlement_same_org_fk
    foreign key (organization_id, converted_settlement_id)
    references public.settlements (organization_id, id) on delete set null (converted_settlement_id),
  constraint amazon_statement_candidates_period_check check (period_end >= period_start),
  constraint amazon_statement_candidates_source_revision_check check (btrim(source_revision) <> ''),
  constraint amazon_statement_candidates_preview_revision_check check (btrim(preview_revision) <> ''),
  constraint amazon_statement_candidates_amounts_finite_check check (
    gross_amount = gross_amount
    and percentage_deductions_amount = percentage_deductions_amount
    and fixed_deductions_amount = fixed_deductions_amount
    and fuel_deductions_amount = fuel_deductions_amount
    and other_deductions_amount = other_deductions_amount
    and total_deductions_amount = total_deductions_amount
    and net_amount = net_amount
  )
);

create index if not exists amazon_statement_candidates_batch_status_idx
  on public.amazon_statement_candidates (organization_id, batch_id, status, period_start);

create unique index if not exists amazon_statement_candidates_converted_settlement_key
  on public.amazon_statement_candidates (organization_id, converted_settlement_id)
  where converted_settlement_id is not null;

create table if not exists public.amazon_statement_candidate_revenue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null,
  revenue_item_id uuid not null,
  load_id uuid not null,
  allocated_gross_amount numeric not null,
  allocation_basis_points integer,
  source_revision text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  display_order integer not null default 0,
  period_override_approved boolean not null default false,
  created_at timestamptz not null default now(),
  constraint amazon_statement_candidate_revenue_org_id_id_key unique (organization_id, id),
  constraint amazon_statement_candidate_revenue_candidate_same_org_fk
    foreign key (organization_id, candidate_id)
    references public.amazon_statement_candidates (organization_id, id) on delete cascade,
  constraint amazon_statement_candidate_revenue_item_same_org_fk
    foreign key (organization_id, revenue_item_id)
    references public.amazon_revenue_items (organization_id, id) on delete restrict,
  constraint amazon_statement_candidate_revenue_load_same_org_fk
    foreign key (organization_id, load_id)
    references public.loads (organization_id, id) on delete restrict,
  constraint amazon_statement_candidate_revenue_basis_points_check
    check (allocation_basis_points is null or allocation_basis_points between 0 and 10000),
  constraint amazon_statement_candidate_revenue_source_revision_check check (btrim(source_revision) <> '')
);

create unique index if not exists amazon_statement_candidate_revenue_source_key
  on public.amazon_statement_candidate_revenue (organization_id, candidate_id, revenue_item_id);

create unique index if not exists amazon_statement_candidate_revenue_load_key
  on public.amazon_statement_candidate_revenue (organization_id, candidate_id, load_id);

create unique index if not exists amazon_statement_candidate_revenue_order_key
  on public.amazon_statement_candidate_revenue (organization_id, candidate_id, display_order);

create table if not exists public.amazon_statement_candidate_fuel_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null,
  transaction_line_id uuid not null,
  expense_id uuid not null,
  allocated_amount numeric not null,
  allocation_basis_points integer,
  source_revision text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  display_order integer not null default 0,
  period_override_approved boolean not null default false,
  created_at timestamptz not null default now(),
  constraint amazon_statement_candidate_fuel_lines_org_id_id_key unique (organization_id, id),
  constraint amazon_statement_candidate_fuel_lines_candidate_same_org_fk
    foreign key (organization_id, candidate_id)
    references public.amazon_statement_candidates (organization_id, id) on delete cascade,
  constraint amazon_statement_candidate_fuel_lines_line_same_org_fk
    foreign key (organization_id, transaction_line_id)
    references public.fuel_import_transaction_lines (organization_id, id) on delete restrict,
  constraint amazon_statement_candidate_fuel_lines_expense_same_org_fk
    foreign key (organization_id, expense_id)
    references public.expenses (organization_id, id) on delete restrict,
  constraint amazon_statement_candidate_fuel_lines_basis_points_check
    check (allocation_basis_points is null or allocation_basis_points between 0 and 10000),
  constraint amazon_statement_candidate_fuel_lines_source_revision_check check (btrim(source_revision) <> '')
);

create unique index if not exists amazon_statement_candidate_fuel_lines_source_key
  on public.amazon_statement_candidate_fuel_lines (organization_id, candidate_id, transaction_line_id);

create unique index if not exists amazon_statement_candidate_fuel_lines_expense_key
  on public.amazon_statement_candidate_fuel_lines (organization_id, candidate_id, expense_id);

create unique index if not exists amazon_statement_candidate_fuel_lines_order_key
  on public.amazon_statement_candidate_fuel_lines (organization_id, candidate_id, display_order);

create table if not exists public.amazon_statement_candidate_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null,
  adjustment_type text not null
    check (adjustment_type in ('driver_percentage','company_percentage','insurance','eld_safety','fuel','toll','parking','load_save','maintenance','miscellaneous','carryover')),
  label text not null,
  calculation_basis text not null
    check (calculation_basis in ('gross_percentage','fixed_amount','selected_source_lines')),
  rate_basis_points integer,
  fixed_amount numeric,
  calculated_amount numeric not null,
  deduction_lane text not null
    check (deduction_lane in ('driver','owner','investor','none')),
  display_order integer not null default 0,
  configuration_source text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint amazon_statement_candidate_adjustments_org_id_id_key unique (organization_id, id),
  constraint amazon_statement_candidate_adjustments_candidate_same_org_fk
    foreign key (organization_id, candidate_id)
    references public.amazon_statement_candidates (organization_id, id) on delete cascade,
  constraint amazon_statement_candidate_adjustments_rate_check
    check (rate_basis_points is null or rate_basis_points between 0 and 10000),
  constraint amazon_statement_candidate_adjustments_basis_check check (
    (calculation_basis = 'gross_percentage' and rate_basis_points is not null and fixed_amount is null)
    or (calculation_basis = 'fixed_amount' and fixed_amount is not null and rate_basis_points is null)
    or (calculation_basis = 'selected_source_lines' and rate_basis_points is null)
  ),
  constraint amazon_statement_candidate_adjustments_label_check check (btrim(label) <> ''),
  constraint amazon_statement_candidate_adjustments_source_check check (btrim(configuration_source) <> '')
);

create unique index if not exists amazon_statement_candidate_adjustments_order_key
  on public.amazon_statement_candidate_adjustments (organization_id, candidate_id, display_order);

create or replace function public.guard_amazon_statement_candidate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'converted' then
      raise exception 'Converted Amazon statement candidates are immutable.';
    end if;
    if new.organization_id is distinct from old.organization_id then
      raise exception 'Amazon statement candidate organization cannot be changed.';
    end if;
    if new.converted_settlement_id is not null and new.status <> 'converted' then
      raise exception 'Converted settlement lineage requires converted status.';
    end if;
  end if;
  if tg_op = 'DELETE' and old.status = 'converted' then
    raise exception 'Converted Amazon statement candidates are immutable.';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.guard_amazon_statement_candidate_revenue_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.candidate_id is distinct from old.candidate_id
    or new.revenue_item_id is distinct from old.revenue_item_id
    or new.load_id is distinct from old.load_id then
    raise exception 'Amazon statement candidate revenue identity cannot be changed.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_amazon_statement_candidate_fuel_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.candidate_id is distinct from old.candidate_id
    or new.transaction_line_id is distinct from old.transaction_line_id
    or new.expense_id is distinct from old.expense_id then
    raise exception 'Amazon statement candidate fuel identity cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists amazon_statement_candidates_guard on public.amazon_statement_candidates;
create trigger amazon_statement_candidates_guard
  before update or delete on public.amazon_statement_candidates
  for each row execute function public.guard_amazon_statement_candidate();

drop trigger if exists amazon_statement_candidate_revenue_identity_guard on public.amazon_statement_candidate_revenue;
create trigger amazon_statement_candidate_revenue_identity_guard
  before update on public.amazon_statement_candidate_revenue
  for each row execute function public.guard_amazon_statement_candidate_revenue_identity();

drop trigger if exists amazon_statement_candidate_fuel_identity_guard on public.amazon_statement_candidate_fuel_lines;
create trigger amazon_statement_candidate_fuel_identity_guard
  before update on public.amazon_statement_candidate_fuel_lines
  for each row execute function public.guard_amazon_statement_candidate_fuel_identity();

drop trigger if exists amazon_statement_candidates_updated_at on public.amazon_statement_candidates;
create trigger amazon_statement_candidates_updated_at
  before update on public.amazon_statement_candidates
  for each row execute function public.touch_amazon_import_updated_at();

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_statement_candidates',
    'amazon_statement_candidate_revenue',
    'amazon_statement_candidate_fuel_lines',
    'amazon_statement_candidate_adjustments'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (organization_id = (select public.current_org_id()));',
      t, t
    );
  end loop;
end $$;

create policy amazon_statement_candidates_insert on public.amazon_statement_candidates
  for insert to authenticated
  with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));

create policy amazon_statement_candidates_update on public.amazon_statement_candidates
  for update to authenticated
  using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()) and status <> 'converted')
  with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()) and status <> 'converted');

create policy amazon_statement_candidates_delete on public.amazon_statement_candidates
  for delete to authenticated
  using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()) and status <> 'converted');

create policy amazon_statement_candidate_revenue_insert on public.amazon_statement_candidate_revenue
  for insert to authenticated
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_revenue.organization_id
        and c.id = amazon_statement_candidate_revenue.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_revenue_update on public.amazon_statement_candidate_revenue
  for update to authenticated
  using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_revenue.organization_id
        and c.id = amazon_statement_candidate_revenue.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_revenue_delete on public.amazon_statement_candidate_revenue
  for delete to authenticated
  using (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_revenue.organization_id
        and c.id = amazon_statement_candidate_revenue.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_fuel_lines_insert on public.amazon_statement_candidate_fuel_lines
  for insert to authenticated
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_fuel_lines.organization_id
        and c.id = amazon_statement_candidate_fuel_lines.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_fuel_lines_update on public.amazon_statement_candidate_fuel_lines
  for update to authenticated
  using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_fuel_lines.organization_id
        and c.id = amazon_statement_candidate_fuel_lines.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_fuel_lines_delete on public.amazon_statement_candidate_fuel_lines
  for delete to authenticated
  using (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_fuel_lines.organization_id
        and c.id = amazon_statement_candidate_fuel_lines.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_adjustments_insert on public.amazon_statement_candidate_adjustments
  for insert to authenticated
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_adjustments.organization_id
        and c.id = amazon_statement_candidate_adjustments.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_adjustments_update on public.amazon_statement_candidate_adjustments
  for update to authenticated
  using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_adjustments.organization_id
        and c.id = amazon_statement_candidate_adjustments.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_adjustments_delete on public.amazon_statement_candidate_adjustments
  for delete to authenticated
  using (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_adjustments.organization_id
        and c.id = amazon_statement_candidate_adjustments.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

grant select, insert, update, delete on table
  public.amazon_statement_candidates,
  public.amazon_statement_candidate_revenue,
  public.amazon_statement_candidate_fuel_lines,
  public.amazon_statement_candidate_adjustments
to authenticated, service_role;

revoke execute on function public.guard_amazon_statement_candidate() from public, anon;
revoke execute on function public.guard_amazon_statement_candidate_revenue_identity() from public, anon;
revoke execute on function public.guard_amazon_statement_candidate_fuel_identity() from public, anon;

-- 20260716070000_amazon_server_workflow_hardening.sql

-- Amazon server workflow hardening.
-- Adds database-enforced concurrency boundaries for candidate conversion,
-- per-file source persistence, and batch status transitions. This migration is
-- intentionally additive and does not run migrations, create UI, or weaken the
-- existing settlement workflow.

set search_path = public, extensions;

create unique index if not exists amazon_statement_candidates_one_conversion_key
  on public.amazon_statement_candidates (organization_id, id, converted_settlement_id)
  where converted_settlement_id is not null;

alter table public.amazon_statement_candidates
  add column if not exists conversion_idempotency_key text;

create unique index if not exists amazon_statement_candidates_conversion_idempotency_key
  on public.amazon_statement_candidates (organization_id, conversion_idempotency_key)
  where conversion_idempotency_key is not null;

create or replace function public.transition_amazon_import_batch_atomic(
  p_batch_id uuid,
  p_expected_status text,
  p_next_status text,
  p_operation text,
  p_expected_updated_at timestamptz default null,
  p_has_blocking_issues boolean default false,
  p_financial_reconciled boolean default false
)
returns table (
  id uuid,
  organization_id uuid,
  status text,
  parser_bundle_version text,
  period_start date,
  period_end date,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_batch public.amazon_import_batches%rowtype;
begin
  if v_org is null or not (select public.is_org_writer()) then
    raise exception 'Writer role is required.';
  end if;

  select *
    into v_batch
  from public.amazon_import_batches b
  where b.organization_id = v_org
    and b.id = p_batch_id
  for update;

  if not found then
    raise exception 'Amazon import batch not found.';
  end if;
  if v_batch.status = 'archived' then
    raise exception 'Archived Amazon import batches are immutable.';
  end if;
  if v_batch.status is distinct from p_expected_status then
    raise exception 'Stale Amazon import batch status.';
  end if;
  if p_expected_updated_at is not null and v_batch.updated_at is distinct from p_expected_updated_at then
    raise exception 'Stale Amazon import batch revision.';
  end if;
  if not (
    (v_batch.status = 'uploaded' and p_next_status = 'parsing' and p_operation = 'parse_files')
    or (v_batch.status = 'parsing' and p_next_status = 'parsed' and p_operation = 'persist_normalized_sources')
    or (v_batch.status = 'parsed' and p_next_status = 'needs_review' and p_operation in ('resolve_references','persist_normalized_sources'))
    or (v_batch.status = 'parsed' and p_next_status = 'reconciled' and p_operation = 'reconcile_payment')
    or (v_batch.status = 'needs_review' and p_next_status = 'reconciled' and p_operation = 'resolve_references')
    or (v_batch.status = 'reconciled' and p_next_status = 'ready' and p_operation = 'compile_candidates')
    or (v_batch.status in ('uploaded','parsing') and p_next_status = 'failed' and p_operation = 'parse_files')
    or (v_batch.status = 'parsed' and p_next_status = 'failed' and p_operation = 'persist_normalized_sources')
    or (v_batch.status in ('needs_review','reconciled','ready') and p_next_status = 'archived' and p_operation = 'archive_batch')
    or (v_batch.status = 'failed' and p_next_status = 'uploaded' and p_operation = 'retry_failed')
  ) then
    raise exception 'Invalid Amazon import batch transition.';
  end if;
  if p_next_status = 'ready' and (not p_financial_reconciled or p_has_blocking_issues) then
    raise exception 'Amazon import batch is not ready.';
  end if;

  update public.amazon_import_batches b
     set status = p_next_status,
         updated_at = now()
   where b.organization_id = v_org
     and b.id = p_batch_id
  returning b.* into v_batch;

  return query
    select v_batch.id,
           v_batch.organization_id,
           v_batch.status,
           v_batch.parser_bundle_version,
           v_batch.period_start,
           v_batch.period_end,
           v_batch.updated_at;
end;
$$;

revoke execute on function public.transition_amazon_import_batch_atomic(uuid, text, text, text, timestamptz, boolean, boolean) from public, anon;
grant execute on function public.transition_amazon_import_batch_atomic(uuid, text, text, text, timestamptz, boolean, boolean) to authenticated;

create or replace function public.persist_amazon_source_atomic(
  p_organization_id uuid,
  p_batch_id uuid,
  p_file_id uuid,
  p_source_type text,
  p_parser_name text,
  p_parser_version text,
  p_schema_signature text,
  p_raw_rows jsonb,
  p_issues jsonb,
  p_reconciliations jsonb,
  p_normalized jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_file public.amazon_import_files%rowtype;
  v_invoice_id uuid;
  v_report_id uuid;
  v_raw_count int := coalesce(jsonb_array_length(coalesce(p_raw_rows, '[]'::jsonb)), 0);
  v_issue_count int := coalesce(jsonb_array_length(coalesce(p_issues, '[]'::jsonb)), 0);
  v_reconciliation_count int := coalesce(jsonb_array_length(coalesce(p_reconciliations, '[]'::jsonb)), 0);
  v_record_count int := 0;
begin
  if v_org is null or not (select public.is_org_writer()) then
    raise exception 'Writer role is required.';
  end if;
  if p_organization_id is distinct from v_org then
    raise exception 'Wrong organization.';
  end if;

  select *
    into v_file
  from public.amazon_import_files f
  where f.organization_id = p_organization_id
    and f.batch_id = p_batch_id
    and f.id = p_file_id
  for update;

  if not found then
    raise exception 'Amazon import file not found.';
  end if;
  if v_file.source_type is distinct from p_source_type then
    raise exception 'Amazon import file source type changed.';
  end if;
  if v_file.status = 'archived' then
    raise exception 'Archived Amazon import files are immutable.';
  end if;
  if v_file.status = 'parsed'
    and (
      v_file.parser_version is distinct from p_parser_version
      or v_file.schema_signature is distinct from p_schema_signature
    ) then
    raise exception 'Parser version or schema signature changed; create a controlled source revision.';
  end if;

  update public.amazon_import_files f
     set status = 'parsing',
         parser_name = p_parser_name,
         parser_version = p_parser_version,
         schema_signature = p_schema_signature
   where f.organization_id = p_organization_id
     and f.id = p_file_id;

  insert into public.amazon_import_raw_rows (
    organization_id, batch_id, file_id, source_sheet, source_page, source_group,
    source_row_number, raw_data, normalized_data, parse_status, parse_warning
  )
  select p_organization_id,
         p_batch_id,
         p_file_id,
         r.source_sheet,
         r.source_page,
         r.source_group,
         r.source_row_number,
         coalesce(r.raw_data, '{}'::jsonb),
         coalesce(r.normalized_data, '{}'::jsonb),
         coalesce(r.parse_status, 'parsed'),
         r.parse_warning
  from jsonb_to_recordset(coalesce(p_raw_rows, '[]'::jsonb)) as r(
    source_sheet text,
    source_page int,
    source_group text,
    source_row_number int,
    raw_data jsonb,
    normalized_data jsonb,
    parse_status text,
    parse_warning text
  )
  on conflict (
    organization_id,
    batch_id,
    file_id,
    (coalesce(source_sheet, '__NULL_SOURCE_SHEET__')),
    (coalesce(source_page, -2147483648)),
    (coalesce(source_group, '__NULL_SOURCE_GROUP__')),
    (coalesce(source_row_number, -2147483648))
  )
  do update set
    raw_data = excluded.raw_data,
    normalized_data = excluded.normalized_data,
    parse_status = excluded.parse_status,
    parse_warning = excluded.parse_warning;

  insert into public.amazon_import_issues (
    organization_id, batch_id, file_id, raw_row_id, issue_code, severity, message, details, status
  )
  select p_organization_id,
         p_batch_id,
         p_file_id,
         null,
         i.issue_code,
         i.severity,
         i.message,
         coalesce(i.details, '{}'::jsonb),
         'open'
  from jsonb_to_recordset(coalesce(p_issues, '[]'::jsonb)) as i(
    issue_code text,
    severity text,
    message text,
    details jsonb
  )
  where not exists (
    select 1
    from public.amazon_import_issues existing
    where existing.organization_id = p_organization_id
      and existing.batch_id = p_batch_id
      and existing.file_id = p_file_id
      and existing.status = 'open'
      and existing.details->>'issueKey' = i.details->>'issueKey'
  );

  delete from public.amazon_import_reconciliations r
  where r.organization_id = p_organization_id
    and r.batch_id = p_batch_id
    and r.details->>'fileId' = p_file_id::text;

  insert into public.amazon_import_reconciliations (
    organization_id, batch_id, reconciliation_type, expected_amount, actual_amount,
    difference_amount, expected_count, actual_count, status, details
  )
  select p_organization_id,
         p_batch_id,
         r.reconciliation_type,
         r.expected_amount,
         r.actual_amount,
         case
           when r.expected_amount is null or r.actual_amount is null then null
           else round(r.expected_amount - r.actual_amount, 2)
         end,
         r.expected_count,
         r.actual_count,
         coalesce(r.status, 'passed'),
         coalesce(r.details, '{}'::jsonb) || jsonb_build_object('fileId', p_file_id::text)
  from jsonb_to_recordset(coalesce(p_reconciliations, '[]'::jsonb)) as r(
    reconciliation_type text,
    expected_amount numeric,
    actual_amount numeric,
    expected_count int,
    actual_count int,
    status text,
    details jsonb
  );

  if p_source_type = 'amazon_payment' then
    insert into public.amazon_payment_invoices (
      organization_id, batch_id, file_id, invoice_number, invoice_date, period_start,
      period_end, payment_date, payment_status, carrier_identifier, summary_total,
      parser_version, schema_signature, source_snapshot
    )
    values (
      p_organization_id,
      p_batch_id,
      p_file_id,
      p_normalized->'invoice'->>'invoice_number',
      nullif(p_normalized->'invoice'->>'invoice_date', '')::date,
      nullif(p_normalized->'invoice'->>'period_start', '')::date,
      nullif(p_normalized->'invoice'->>'period_end', '')::date,
      nullif(p_normalized->'invoice'->>'payment_date', '')::date,
      p_normalized->'invoice'->>'payment_status',
      p_normalized->'invoice'->>'carrier_identifier',
      nullif(p_normalized->'invoice'->>'summary_total', '')::numeric,
      p_parser_version,
      p_schema_signature,
      coalesce(p_normalized->'invoice'->'source_snapshot', '{}'::jsonb)
    )
    on conflict (organization_id, file_id, invoice_number)
    do update set
      invoice_date = excluded.invoice_date,
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      payment_date = excluded.payment_date,
      payment_status = excluded.payment_status,
      carrier_identifier = excluded.carrier_identifier,
      summary_total = excluded.summary_total,
      parser_version = excluded.parser_version,
      schema_signature = excluded.schema_signature,
      source_snapshot = excluded.source_snapshot
    returning id into v_invoice_id;

    insert into public.amazon_payment_rows (
      organization_id, batch_id, file_id, raw_row_id, invoice_id, source_row_number,
      source_fingerprint, row_classification, trip_id, load_id, start_date, end_date,
      route_raw, distance, base_amount, fuel_surcharge_amount, toll_amount,
      detention_amount, tonu_amount, other_amount, gross_amount, item_type, status,
      parse_status, source_snapshot
    )
    select p_organization_id,
           p_batch_id,
           p_file_id,
           (
             select rr.id
             from public.amazon_import_raw_rows rr
             where rr.organization_id = p_organization_id
               and rr.batch_id = p_batch_id
               and rr.file_id = p_file_id
               and coalesce(rr.source_sheet, '') = coalesce(r.source_sheet, '')
               and coalesce(rr.source_page, -2147483648) = coalesce(r.source_page, -2147483648)
               and coalesce(rr.source_group, '') = coalesce(r.source_group, '')
               and coalesce(rr.source_row_number, -2147483648) = coalesce(r.source_row_number, -2147483648)
             limit 1
           ),
           v_invoice_id,
           r.source_row_number,
           r.source_fingerprint,
           r.row_classification,
           r.trip_id,
           r.load_id,
           r.start_date,
           r.end_date,
           r.route_raw,
           r.distance,
           r.base_amount,
           r.fuel_surcharge_amount,
           r.toll_amount,
           r.detention_amount,
           r.tonu_amount,
           r.other_amount,
           r.gross_amount,
           r.item_type,
           r.status,
           coalesce(r.parse_status, 'parsed'),
           coalesce(r.source_snapshot, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_normalized->'payment_rows', '[]'::jsonb)) as r(
      source_sheet text,
      source_page int,
      source_group text,
      source_row_number int,
      source_fingerprint text,
      row_classification text,
      trip_id text,
      load_id text,
      start_date date,
      end_date date,
      route_raw text,
      distance numeric,
      base_amount numeric,
      fuel_surcharge_amount numeric,
      toll_amount numeric,
      detention_amount numeric,
      tonu_amount numeric,
      other_amount numeric,
      gross_amount numeric,
      item_type text,
      status text,
      parse_status text,
      source_snapshot jsonb
    )
    on conflict (organization_id, file_id, source_fingerprint)
    do update set
      raw_row_id = excluded.raw_row_id,
      invoice_id = excluded.invoice_id,
      row_classification = excluded.row_classification,
      trip_id = excluded.trip_id,
      load_id = excluded.load_id,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      route_raw = excluded.route_raw,
      distance = excluded.distance,
      base_amount = excluded.base_amount,
      fuel_surcharge_amount = excluded.fuel_surcharge_amount,
      toll_amount = excluded.toll_amount,
      detention_amount = excluded.detention_amount,
      tonu_amount = excluded.tonu_amount,
      other_amount = excluded.other_amount,
      gross_amount = excluded.gross_amount,
      item_type = excluded.item_type,
      status = excluded.status,
      parse_status = excluded.parse_status,
      source_snapshot = excluded.source_snapshot;

    v_record_count := 1 + coalesce(jsonb_array_length(coalesce(p_normalized->'payment_rows', '[]'::jsonb)), 0);
  elsif p_source_type = 'amazon_trips' then
    insert into public.amazon_trip_rows (
      organization_id, batch_id, file_id, raw_row_id, source_row_number, source_fingerprint,
      trip_id, load_id, raw_driver_text, tractor_external_id, operator_type,
      equipment_type, trip_status, load_status, estimated_distance, facility_sequence,
      stops, source_snapshot
    )
    select p_organization_id,
           p_batch_id,
           p_file_id,
           (
             select rr.id
             from public.amazon_import_raw_rows rr
             where rr.organization_id = p_organization_id
               and rr.batch_id = p_batch_id
               and rr.file_id = p_file_id
               and coalesce(rr.source_sheet, '') = coalesce(r.source_sheet, '')
               and coalesce(rr.source_page, -2147483648) = coalesce(r.source_page, -2147483648)
               and coalesce(rr.source_group, '') = coalesce(r.source_group, '')
               and coalesce(rr.source_row_number, -2147483648) = coalesce(r.source_row_number, -2147483648)
             limit 1
           ),
           r.source_row_number,
           r.source_fingerprint,
           r.trip_id,
           r.load_id,
           r.raw_driver_text,
           r.tractor_external_id,
           r.operator_type,
           r.equipment_type,
           r.trip_status,
           r.load_status,
           r.estimated_distance,
           coalesce(r.facility_sequence, '[]'::jsonb),
           coalesce(r.stops, '[]'::jsonb),
           coalesce(r.source_snapshot, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_normalized->'trip_rows', '[]'::jsonb)) as r(
      source_sheet text,
      source_page int,
      source_group text,
      source_row_number int,
      source_fingerprint text,
      trip_id text,
      load_id text,
      raw_driver_text text,
      tractor_external_id text,
      operator_type text,
      equipment_type text,
      trip_status text,
      load_status text,
      estimated_distance numeric,
      facility_sequence jsonb,
      stops jsonb,
      source_snapshot jsonb
    )
    on conflict (organization_id, file_id, source_fingerprint)
    do update set
      raw_row_id = excluded.raw_row_id,
      source_row_number = excluded.source_row_number,
      trip_id = excluded.trip_id,
      load_id = excluded.load_id,
      raw_driver_text = excluded.raw_driver_text,
      tractor_external_id = excluded.tractor_external_id,
      operator_type = excluded.operator_type,
      equipment_type = excluded.equipment_type,
      trip_status = excluded.trip_status,
      load_status = excluded.load_status,
      estimated_distance = excluded.estimated_distance,
      facility_sequence = excluded.facility_sequence,
      stops = excluded.stops,
      source_snapshot = excluded.source_snapshot;

    delete from public.amazon_trip_driver_tokens t
    using public.amazon_trip_rows tr
    where t.organization_id = p_organization_id
      and tr.organization_id = t.organization_id
      and tr.id = t.trip_row_id
      and tr.file_id = p_file_id;

    insert into public.amazon_trip_driver_tokens (
      organization_id, trip_row_id, token_order, raw_name, normalized_name,
      is_team_assignment, requires_split_rule
    )
    select p_organization_id,
           tr.id,
           d.token_order,
           d.raw_name,
           d.normalized_name,
           coalesce(d.is_team_assignment, false),
           coalesce(d.requires_split_rule, false)
    from jsonb_to_recordset(coalesce(p_normalized->'driver_tokens', '[]'::jsonb)) as d(
      source_fingerprint text,
      token_order int,
      raw_name text,
      normalized_name text,
      is_team_assignment boolean,
      requires_split_rule boolean
    )
    join public.amazon_trip_rows tr
      on tr.organization_id = p_organization_id
     and tr.file_id = p_file_id
     and tr.source_fingerprint = d.source_fingerprint;

    v_record_count :=
      coalesce(jsonb_array_length(coalesce(p_normalized->'trip_rows', '[]'::jsonb)), 0)
      + coalesce(jsonb_array_length(coalesce(p_normalized->'driver_tokens', '[]'::jsonb)), 0);
  elsif p_source_type = 'fuel_card' then
    insert into public.fuel_import_reports (
      organization_id, batch_id, file_id, provider, carrier_identifier, period_start,
      period_end, generated_at, reported_transaction_count, reported_total_amount,
      reported_total_quantity, reported_discount_amount, parser_name, parser_version,
      schema_signature, source_snapshot
    )
    values (
      p_organization_id,
      p_batch_id,
      p_file_id,
      p_normalized->'report'->>'provider',
      p_normalized->'report'->>'carrier_identifier',
      nullif(p_normalized->'report'->>'period_start', '')::date,
      nullif(p_normalized->'report'->>'period_end', '')::date,
      nullif(p_normalized->'report'->>'generated_at', '')::timestamptz,
      nullif(p_normalized->'report'->>'reported_transaction_count', '')::int,
      nullif(p_normalized->'report'->>'reported_total_amount', '')::numeric,
      nullif(p_normalized->'report'->>'reported_total_quantity', '')::numeric,
      nullif(p_normalized->'report'->>'reported_discount_amount', '')::numeric,
      p_parser_name,
      p_parser_version,
      p_schema_signature,
      coalesce(p_normalized->'report'->'source_snapshot', '{}'::jsonb)
    )
    on conflict (organization_id, file_id)
    do update set
      carrier_identifier = excluded.carrier_identifier,
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      generated_at = excluded.generated_at,
      reported_transaction_count = excluded.reported_transaction_count,
      reported_total_amount = excluded.reported_total_amount,
      reported_total_quantity = excluded.reported_total_quantity,
      reported_discount_amount = excluded.reported_discount_amount,
      parser_name = excluded.parser_name,
      parser_version = excluded.parser_version,
      schema_signature = excluded.schema_signature,
      source_snapshot = excluded.source_snapshot
    returning id into v_report_id;

    insert into public.fuel_import_card_groups (
      organization_id, report_id, source_group_number, card_external_id, card_last_four,
      driver_label_raw, driver_label_normalized, unit_label_raw, unit_label_normalized,
      reported_transaction_count, reported_total_amount, reported_total_quantity,
      reported_discount_amount, is_placeholder_group, source_page_start, source_page_end,
      source_snapshot
    )
    select p_organization_id,
           v_report_id,
           g.source_group_number,
           g.card_external_id,
           g.card_last_four,
           g.driver_label_raw,
           g.driver_label_normalized,
           g.unit_label_raw,
           g.unit_label_normalized,
           g.reported_transaction_count,
           g.reported_total_amount,
           g.reported_total_quantity,
           g.reported_discount_amount,
           coalesce(g.is_placeholder_group, false),
           g.source_page_start,
           g.source_page_end,
           coalesce(g.source_snapshot, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_normalized->'card_groups', '[]'::jsonb)) as g(
      source_group_number int,
      card_external_id text,
      card_last_four text,
      driver_label_raw text,
      driver_label_normalized text,
      unit_label_raw text,
      unit_label_normalized text,
      reported_transaction_count int,
      reported_total_amount numeric,
      reported_total_quantity numeric,
      reported_discount_amount numeric,
      is_placeholder_group boolean,
      source_page_start int,
      source_page_end int,
      source_snapshot jsonb
    )
    on conflict (organization_id, report_id, source_group_number)
    do update set
      card_external_id = excluded.card_external_id,
      card_last_four = excluded.card_last_four,
      driver_label_raw = excluded.driver_label_raw,
      driver_label_normalized = excluded.driver_label_normalized,
      unit_label_raw = excluded.unit_label_raw,
      unit_label_normalized = excluded.unit_label_normalized,
      reported_transaction_count = excluded.reported_transaction_count,
      reported_total_amount = excluded.reported_total_amount,
      reported_total_quantity = excluded.reported_total_quantity,
      reported_discount_amount = excluded.reported_discount_amount,
      is_placeholder_group = excluded.is_placeholder_group,
      source_page_start = excluded.source_page_start,
      source_page_end = excluded.source_page_end,
      source_snapshot = excluded.source_snapshot;

    insert into public.fuel_import_transactions (
      organization_id, report_id, card_group_id, source_transaction_fingerprint,
      transaction_at, invoice_number, merchant_raw, city_raw, state_raw,
      odometer_raw, fees_amount, source_page, source_row_number, source_snapshot
    )
    select p_organization_id,
           v_report_id,
           cg.id,
           t.source_transaction_fingerprint,
           t.transaction_at,
           t.invoice_number,
           t.merchant_raw,
           t.city_raw,
           t.state_raw,
           t.odometer_raw,
           t.fees_amount,
           t.source_page,
           t.source_row_number,
           coalesce(t.source_snapshot, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_normalized->'transactions', '[]'::jsonb)) as t(
      source_group_number int,
      source_transaction_fingerprint text,
      transaction_at timestamptz,
      invoice_number text,
      merchant_raw text,
      city_raw text,
      state_raw text,
      odometer_raw text,
      fees_amount numeric,
      source_page int,
      source_row_number int,
      source_snapshot jsonb
    )
    join public.fuel_import_card_groups cg
      on cg.organization_id = p_organization_id
     and cg.report_id = v_report_id
     and cg.source_group_number = t.source_group_number
    on conflict (organization_id, report_id, source_transaction_fingerprint)
    do update set
      card_group_id = excluded.card_group_id,
      transaction_at = excluded.transaction_at,
      invoice_number = excluded.invoice_number,
      merchant_raw = excluded.merchant_raw,
      city_raw = excluded.city_raw,
      state_raw = excluded.state_raw,
      odometer_raw = excluded.odometer_raw,
      fees_amount = excluded.fees_amount,
      source_page = excluded.source_page,
      source_row_number = excluded.source_row_number,
      source_snapshot = excluded.source_snapshot;

    insert into public.fuel_import_transaction_lines (
      organization_id, transaction_id, source_line_order, product_type_raw,
      product_type_normalized, quantity, retail_unit_price, charged_unit_price,
      discount_per_unit, discount_amount, deal_type, charged_amount, source_snapshot
    )
    select p_organization_id,
           tx.id,
           l.source_line_order,
           l.product_type_raw,
           l.product_type_normalized,
           l.quantity,
           l.retail_unit_price,
           l.charged_unit_price,
           l.discount_per_unit,
           l.discount_amount,
           l.deal_type,
           l.charged_amount,
           coalesce(l.source_snapshot, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_normalized->'product_lines', '[]'::jsonb)) as l(
      source_transaction_fingerprint text,
      source_line_order int,
      product_type_raw text,
      product_type_normalized text,
      quantity numeric,
      retail_unit_price numeric,
      charged_unit_price numeric,
      discount_per_unit numeric,
      discount_amount numeric,
      deal_type text,
      charged_amount numeric,
      source_snapshot jsonb
    )
    join public.fuel_import_transactions tx
      on tx.organization_id = p_organization_id
     and tx.report_id = v_report_id
     and tx.source_transaction_fingerprint = l.source_transaction_fingerprint
    on conflict (organization_id, transaction_id, source_line_order)
    do update set
      product_type_raw = excluded.product_type_raw,
      product_type_normalized = excluded.product_type_normalized,
      quantity = excluded.quantity,
      retail_unit_price = excluded.retail_unit_price,
      charged_unit_price = excluded.charged_unit_price,
      discount_per_unit = excluded.discount_per_unit,
      discount_amount = excluded.discount_amount,
      deal_type = excluded.deal_type,
      charged_amount = excluded.charged_amount,
      source_snapshot = excluded.source_snapshot;

    v_record_count :=
      1
      + coalesce(jsonb_array_length(coalesce(p_normalized->'card_groups', '[]'::jsonb)), 0)
      + coalesce(jsonb_array_length(coalesce(p_normalized->'transactions', '[]'::jsonb)), 0)
      + coalesce(jsonb_array_length(coalesce(p_normalized->'product_lines', '[]'::jsonb)), 0);
  elsif p_source_type = 'statement_reference' then
    v_record_count := 0;
  else
    raise exception 'Unsupported Amazon source type.';
  end if;

  update public.amazon_import_files f
     set status = 'parsed',
         parser_name = p_parser_name,
         parser_version = p_parser_version,
         schema_signature = p_schema_signature
   where f.organization_id = p_organization_id
     and f.id = p_file_id;

  return jsonb_build_object(
    'normalizedKind', p_source_type,
    'recordCount', v_record_count,
    'rawRowCount', v_raw_count,
    'issueCount', v_issue_count,
    'reconciliationCount', v_reconciliation_count
  );
end;
$$;

revoke execute on function public.persist_amazon_source_atomic(uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.persist_amazon_source_atomic(uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.convert_amazon_candidate_atomic(
  p_candidate_id uuid,
  p_expected_preview_revision text,
  p_expected_source_revision text,
  p_expected_configuration_revision text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_user uuid := auth.uid();
  v_candidate public.amazon_statement_candidates%rowtype;
  v_config_revision text;
  v_line_items jsonb;
  v_load_ids uuid[];
  v_expense_ids uuid[];
  v_settlement_id uuid;
  v_driver_id uuid;
  v_owner_id uuid;
  v_usage_group text;
  v_idempotency_key text;
begin
  if v_org is null or v_user is null or not (select public.is_org_writer()) then
    raise exception 'Writer role is required.';
  end if;

  select *
    into v_candidate
  from public.amazon_statement_candidates c
  where c.organization_id = v_org
    and c.id = p_candidate_id
  for update;

  if not found then
    raise exception 'Amazon statement candidate not found.';
  end if;

  if v_candidate.status = 'converted' then
    if v_candidate.converted_settlement_id is null then
      raise exception 'Converted candidate is missing settlement lineage.';
    end if;
    return jsonb_build_object(
      'status', 'already_converted',
      'settlementId', v_candidate.converted_settlement_id
    );
  end if;

  if v_candidate.status <> 'ready' then
    raise exception 'Amazon statement candidate is not ready.';
  end if;
  if v_candidate.preview_revision is distinct from p_expected_preview_revision then
    raise exception 'Stale Amazon statement candidate preview revision.';
  end if;
  if v_candidate.source_revision is distinct from p_expected_source_revision then
    raise exception 'Stale Amazon statement candidate source revision.';
  end if;

  v_config_revision := md5(v_candidate.configuration_snapshot::text);
  if p_expected_configuration_revision is not null and v_config_revision is distinct from p_expected_configuration_revision then
    raise exception 'Stale Amazon statement candidate configuration revision.';
  end if;

  v_usage_group := public.settlement_usage_group(v_candidate.statement_type);
  if v_usage_group is null then
    raise exception 'Unsupported Amazon statement candidate settlement type.';
  end if;

  select coalesce(array_agg(r.load_id order by r.display_order), '{}'::uuid[])
    into v_load_ids
  from public.amazon_statement_candidate_revenue r
  where r.organization_id = v_org
    and r.candidate_id = p_candidate_id;

  select coalesce(array_agg(f.expense_id order by f.display_order), '{}'::uuid[])
    into v_expense_ids
  from public.amazon_statement_candidate_fuel_lines f
  where f.organization_id = v_org
    and f.candidate_id = p_candidate_id;

  if coalesce(array_length(v_load_ids, 1), 0) = 0 then
    raise exception 'Amazon statement candidate has no selected revenue loads.';
  end if;

  perform 1
  from public.settlement_load_links l
  where l.organization_id = v_org
    and l.load_id = any(v_load_ids)
    and l.released_at is null
    and (
      case when l.usage_group in ('owner','investor') then 'asset_owner' else l.usage_group end
    ) = (
      case when v_usage_group in ('owner','investor') then 'asset_owner' else v_usage_group end
    )
  for update;
  if found then
    raise exception 'One or more selected Amazon loads are already linked to a settlement lane.';
  end if;

  if coalesce(array_length(v_expense_ids, 1), 0) > 0 then
    perform 1
    from public.settlement_expense_links e
    where e.organization_id = v_org
      and e.expense_id = any(v_expense_ids)
      and e.released_at is null
      and (
        case when e.usage_group in ('owner','investor') then 'asset_owner' else e.usage_group end
      ) = (
        case when v_usage_group in ('owner','investor') then 'asset_owner' else v_usage_group end
      )
    for update;
    if found then
      raise exception 'One or more selected Amazon expenses are already linked to a settlement lane.';
    end if;
  end if;

  v_line_items := (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', li.value->>'key',
      'label_en', coalesce(li.value->>'labelEn', li.value->>'label_en', li.value->>'key'),
      'label_tr', coalesce(li.value->>'labelTr', li.value->>'label_tr', li.value->>'labelEn', li.value->>'key'),
      'amount', coalesce(nullif(li.value->>'amount', '')::numeric, 0),
      'is_our_revenue', coalesce((li.value->>'isOurRevenue')::boolean, (li.value->>'is_our_revenue')::boolean, false),
      'sort_order', li.ordinality - 1
    ) order by li.ordinality), '[]'::jsonb)
    from jsonb_array_elements(coalesce(v_candidate.calculation_snapshot->'lineItems', '[]'::jsonb)) with ordinality li(value, ordinality)
  );

  v_driver_id := case when v_usage_group = 'driver' then v_candidate.payee_id else null end;
  v_owner_id := case when v_usage_group in ('owner','investor') then v_candidate.payee_id else null end;
  v_idempotency_key := 'amazon-candidate:' || p_candidate_id::text || ':' || p_expected_preview_revision;

  v_settlement_id := public.create_settlement_with_links_atomic(
    v_org,
    v_user,
    v_candidate.statement_type,
    v_usage_group,
    null,
    null,
    v_candidate.vehicle_id,
    v_driver_id,
    v_owner_id,
    v_candidate.period_start,
    v_candidate.period_end,
    v_candidate.configuration_snapshot || jsonb_build_object(
      'amazon_statement_candidate_id', v_candidate.id,
      'amazon_statement_candidate_preview_revision', v_candidate.preview_revision,
      'amazon_statement_candidate_source_revision', v_candidate.source_revision
    ),
    v_candidate.gross_amount,
    v_candidate.total_deductions_amount,
    0,
    v_candidate.net_amount,
    null,
    v_line_items,
    v_load_ids,
    v_expense_ids
  );

  update public.amazon_statement_candidates c
     set status = 'converted',
         converted_settlement_id = v_settlement_id,
         converted_at = now(),
         conversion_idempotency_key = v_idempotency_key
   where c.organization_id = v_org
     and c.id = p_candidate_id
     and c.status = 'ready'
     and c.preview_revision = p_expected_preview_revision
     and c.source_revision = p_expected_source_revision;

  if not found then
    raise exception 'Amazon statement candidate conversion state changed before completion.';
  end if;

  return jsonb_build_object(
    'status', 'converted',
    'settlementId', v_settlement_id,
    'idempotencyKey', v_idempotency_key
  );
end;
$$;

revoke execute on function public.convert_amazon_candidate_atomic(uuid, text, text, text) from public, anon;
grant execute on function public.convert_amazon_candidate_atomic(uuid, text, text, text) to authenticated;

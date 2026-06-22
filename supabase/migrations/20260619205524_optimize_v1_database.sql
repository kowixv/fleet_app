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
  p_expense_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org_id uuid := current_org_id();
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
  numeric, numeric, numeric, jsonb, uuid[], uuid[]
) from public, anon;
grant execute on function create_settlement_atomic(
  text, uuid, uuid, uuid, uuid, uuid, date, date, jsonb, numeric, numeric,
  numeric, numeric, numeric, jsonb, uuid[], uuid[]
) to authenticated;

-- Settlement workflow hardening: link-table usage lanes, guarded status flow,
-- and service-only atomic persistence. Safe to re-run; do not drop legacy links.

set search_path = public, extensions;

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
  if p_usage_group is distinct from settlement_usage_group(p_settlement_type) then
    raise exception 'Invalid settlement usage group.';
  end if;
  if p_settlement_type = 'external_carrier_statement' and p_external_carrier_id is null then
    raise exception 'External carrier is required.';
  end if;
  if p_settlement_type <> 'external_carrier_statement' and (p_vehicle_id is null or p_week_start is null or p_week_end is null) then
    raise exception 'Vehicle and period are required.';
  end if;
  if p_week_start is not null and p_week_end is not null and p_week_end < p_week_start then
    raise exception 'Settlement week_end cannot be before week_start.';
  end if;
  if p_settlement_type in ('company_driver','box_truck_driver') and p_driver_id is null then
    raise exception 'Driver is required.';
  end if;
  if p_settlement_type = 'owner_operator' and p_owner_id is null then
    raise exception 'Owner is required.';
  end if;
  if p_settlement_type = 'managed_investor' and p_owner_id is null then
    raise exception 'Investor is required.';
  end if;

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
    where organization_id = p_organization_id
      and id = any(p_load_ids)
      and vehicle_id = p_vehicle_id
      and delivery_date >= p_week_start
      and delivery_date <= p_week_end
      and status in ('delivered','paid')
      and gross_amount >= 0
    order by id
    for update;
    get diagnostics v_actual = row_count;
    if v_actual <> v_expected_loads then raise exception 'One or more loads are no longer eligible.'; end if;
  end if;

  if v_expected_expenses > 0 then
    perform 1 from expenses
    where organization_id = p_organization_id
      and id = any(p_expense_ids)
      and vehicle_id = p_vehicle_id
      and date >= p_week_start
      and date <= p_week_end
      and deduct_from_settlement = true
      and (
        (p_usage_group = 'driver' and (deduct_from_driver = true or (not deduct_from_driver and not deduct_from_owner and not deduct_from_investor)))
        or (p_usage_group = 'owner' and (deduct_from_owner = true or (not deduct_from_driver and not deduct_from_owner and not deduct_from_investor)))
        or (p_usage_group = 'investor' and (deduct_from_investor = true or (not deduct_from_driver and not deduct_from_owner and not deduct_from_investor)))
      )
    order by id
    for update;
    get diagnostics v_actual = row_count;
    if v_actual <> v_expected_expenses then raise exception 'One or more expenses are no longer eligible.'; end if;
  end if;

  insert into settlements (
    organization_id, settlement_type, company_id, external_carrier_id, vehicle_id,
    driver_id, owner_id, week_start, week_end, config, gross_revenue,
    total_deductions, our_commission_earned, net_pay, external_net_pay,
    status, created_by
  ) values (
    p_organization_id, p_settlement_type, p_company_id, p_external_carrier_id, p_vehicle_id,
    p_driver_id, p_owner_id, p_week_start, p_week_end, coalesce(p_config, '{}'::jsonb),
    coalesce(p_gross_revenue, 0), coalesce(p_total_deductions, 0),
    coalesce(p_our_commission_earned, 0), coalesce(p_net_pay, 0), p_external_net_pay,
    'draft', p_created_by
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

create or replace function transition_settlement_status(
  p_settlement_id uuid,
  p_new_status text,
  p_void_reason text default null
)
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
  ) then
    raise exception 'Invalid settlement status transition.';
  end if;

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

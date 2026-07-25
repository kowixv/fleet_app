-- Maintenance PR 3: budgets, warranty claims, vendor scorecards and decision support.
-- Additive and organization-scoped. Normal writes use authenticated RLS.

alter table public.settings
  add column if not exists maintenance_average_daily_contribution numeric not null default 600,
  add column if not exists maintenance_replacement_cost_12m_threshold numeric not null default 30000,
  add column if not exists maintenance_replacement_cpm_threshold numeric not null default 0.35,
  add column if not exists maintenance_replacement_downtime_days_threshold numeric not null default 30,
  add column if not exists maintenance_replacement_vehicle_age_years_threshold numeric not null default 8;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'settings_maintenance_decision_thresholds_chk'
      and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings
      add constraint settings_maintenance_decision_thresholds_chk check (
        maintenance_average_daily_contribution >= 0
        and maintenance_replacement_cost_12m_threshold >= 0
        and maintenance_replacement_cpm_threshold >= 0
        and maintenance_replacement_downtime_days_threshold >= 0
        and maintenance_replacement_vehicle_age_years_threshold >= 0
      ) not valid;
  end if;
end $$;

create table if not exists public.maintenance_budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  fiscal_year integer not null,
  month integer,
  scope text not null,
  vehicle_id uuid,
  category text,
  vendor text,
  budget_amount numeric not null,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint maintenance_budgets_org_id_id_key unique (organization_id, id),
  constraint maintenance_budgets_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete cascade,
  constraint maintenance_budgets_created_by_same_org_fk
    foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete set null (created_by),
  constraint maintenance_budgets_updated_by_same_org_fk
    foreign key (organization_id, updated_by)
    references public.profiles (organization_id, id) on delete set null (updated_by),
  constraint maintenance_budgets_year_chk check (fiscal_year between 2000 and 2200),
  constraint maintenance_budgets_month_chk check (month is null or month between 1 and 12),
  constraint maintenance_budgets_amount_chk check (budget_amount >= 0),
  constraint maintenance_budgets_scope_chk
    check (scope in ('annual_org', 'monthly_org', 'vehicle', 'category', 'vendor')),
  constraint maintenance_budgets_shape_chk check (
    (scope = 'annual_org' and month is null and vehicle_id is null and category is null and vendor is null)
    or (scope = 'monthly_org' and month is not null and vehicle_id is null and category is null and vendor is null)
    or (scope = 'vehicle' and vehicle_id is not null and category is null and vendor is null)
    or (scope = 'category' and vehicle_id is null and category is not null and length(btrim(category)) > 0 and vendor is null)
    or (scope = 'vendor' and vehicle_id is null and category is null and vendor is not null and length(btrim(vendor)) > 0)
  )
);

create unique index if not exists maintenance_budgets_scope_unique_idx
  on public.maintenance_budgets (
    organization_id,
    fiscal_year,
    coalesce(month, 0),
    scope,
    coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(category, ''),
    coalesce(lower(btrim(vendor)), '')
  );
create index if not exists maintenance_budgets_org_year_scope_idx
  on public.maintenance_budgets (organization_id, fiscal_year, scope, month);
create index if not exists maintenance_budgets_vehicle_idx
  on public.maintenance_budgets (organization_id, vehicle_id, fiscal_year)
  where vehicle_id is not null;

create table if not exists public.maintenance_warranty_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  work_order_id uuid,
  maintenance_record_id uuid,
  vehicle_id uuid not null,
  vendor_manufacturer text not null,
  claim_number text,
  submitted_date date,
  submitted_amount numeric,
  approved_amount numeric,
  received_amount numeric,
  expected_recovery_date date,
  status text not null default 'draft',
  denial_reason text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  constraint maintenance_warranty_claims_org_id_id_key unique (organization_id, id),
  constraint maintenance_warranty_claims_work_order_same_org_fk
    foreign key (organization_id, work_order_id)
    references public.maintenance_work_orders (organization_id, id) on delete set null (work_order_id),
  constraint maintenance_warranty_claims_record_same_org_fk
    foreign key (organization_id, maintenance_record_id)
    references public.maintenance_records (organization_id, id) on delete set null (maintenance_record_id),
  constraint maintenance_warranty_claims_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint maintenance_warranty_claims_created_by_same_org_fk
    foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete set null (created_by),
  constraint maintenance_warranty_claims_updated_by_same_org_fk
    foreign key (organization_id, updated_by)
    references public.profiles (organization_id, id) on delete set null (updated_by),
  constraint maintenance_warranty_claims_closed_by_same_org_fk
    foreign key (organization_id, closed_by)
    references public.profiles (organization_id, id) on delete set null (closed_by),
  constraint maintenance_warranty_claims_source_chk
    check (work_order_id is not null or maintenance_record_id is not null),
  constraint maintenance_warranty_claims_vendor_chk check (length(btrim(vendor_manufacturer)) >= 2),
  constraint maintenance_warranty_claims_status_chk check (
    status in ('draft', 'submitted', 'under_review', 'approved', 'partially_approved', 'denied', 'paid', 'closed')
  ),
  constraint maintenance_warranty_claims_money_chk check (
    coalesce(submitted_amount, 0) >= 0
    and coalesce(approved_amount, 0) >= 0
    and coalesce(received_amount, 0) >= 0
    and (approved_amount is null or submitted_amount is null or approved_amount <= submitted_amount)
    and (received_amount is null or approved_amount is null or received_amount <= approved_amount)
  ),
  constraint maintenance_warranty_claims_closed_shape_chk check (
    (status = 'closed' and closed_by is not null and closed_at is not null)
    or (status <> 'closed' and closed_at is null)
  )
);

create unique index if not exists maintenance_warranty_claims_org_claim_number_idx
  on public.maintenance_warranty_claims (organization_id, lower(btrim(claim_number)))
  where claim_number is not null and length(btrim(claim_number)) > 0;
create index if not exists maintenance_warranty_claims_org_status_date_idx
  on public.maintenance_warranty_claims (organization_id, status, expected_recovery_date);
create index if not exists maintenance_warranty_claims_vehicle_idx
  on public.maintenance_warranty_claims (organization_id, vehicle_id, created_at desc);
create index if not exists maintenance_warranty_claims_work_order_idx
  on public.maintenance_warranty_claims (organization_id, work_order_id)
  where work_order_id is not null;
create index if not exists maintenance_warranty_claims_record_idx
  on public.maintenance_warranty_claims (organization_id, maintenance_record_id)
  where maintenance_record_id is not null;

create table if not exists public.maintenance_warranty_claim_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  warranty_claim_id uuid not null,
  from_status text,
  to_status text not null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint maintenance_warranty_claim_events_org_id_id_key unique (organization_id, id),
  constraint maintenance_warranty_claim_events_claim_same_org_fk
    foreign key (organization_id, warranty_claim_id)
    references public.maintenance_warranty_claims (organization_id, id) on delete cascade,
  constraint maintenance_warranty_claim_events_created_by_same_org_fk
    foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete set null (created_by)
);

create index if not exists maintenance_warranty_claim_events_order_idx
  on public.maintenance_warranty_claim_events (organization_id, warranty_claim_id, created_at desc);

alter table public.maintenance_budgets enable row level security;
alter table public.maintenance_warranty_claims enable row level security;
alter table public.maintenance_warranty_claim_events enable row level security;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['maintenance_budgets', 'maintenance_warranty_claims']
  loop
    execute format('drop policy if exists %I_select on public.%I', v_table, v_table);
    execute format('drop policy if exists %I_insert on public.%I', v_table, v_table);
    execute format('drop policy if exists %I_update on public.%I', v_table, v_table);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (organization_id = (select public.current_org_id()))',
      v_table, v_table
    );
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))',
      v_table, v_table
    );
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer())) with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))',
      v_table, v_table
    );
  end loop;
end $$;

drop policy if exists maintenance_warranty_claim_events_select on public.maintenance_warranty_claim_events;
create policy maintenance_warranty_claim_events_select
  on public.maintenance_warranty_claim_events for select to authenticated
  using (organization_id = (select public.current_org_id()));

revoke all on table public.maintenance_budgets from anon, authenticated;
revoke all on table public.maintenance_warranty_claims from anon, authenticated;
revoke all on table public.maintenance_warranty_claim_events from anon, authenticated;
grant select, insert, update on table public.maintenance_budgets to authenticated;
grant select, insert on table public.maintenance_warranty_claims to authenticated;
grant update (
  work_order_id, maintenance_record_id, vehicle_id,
  vendor_manufacturer, claim_number, submitted_date, submitted_amount,
  approved_amount, received_amount, expected_recovery_date, denial_reason, notes
) on table public.maintenance_warranty_claims to authenticated;
grant select on table public.maintenance_warranty_claim_events to authenticated;

create or replace function public.touch_maintenance_decision_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end;
$$;
revoke execute on function public.touch_maintenance_decision_row() from public, anon, authenticated;

drop trigger if exists maintenance_budgets_touch on public.maintenance_budgets;
create trigger maintenance_budgets_touch
  before update on public.maintenance_budgets
  for each row execute function public.touch_maintenance_decision_row();

drop trigger if exists maintenance_warranty_claims_touch on public.maintenance_warranty_claims;
create trigger maintenance_warranty_claims_touch
  before update on public.maintenance_warranty_claims
  for each row execute function public.touch_maintenance_decision_row();

create or replace function public.prepare_maintenance_decision_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  new.updated_by := auth.uid();
  if tg_table_name = 'maintenance_warranty_claims' then
    new.status := 'draft';
  end if;
  return new;
end;
$$;
revoke execute on function public.prepare_maintenance_decision_insert() from public, anon, authenticated;

drop trigger if exists maintenance_budgets_prepare on public.maintenance_budgets;
create trigger maintenance_budgets_prepare
  before insert on public.maintenance_budgets
  for each row execute function public.prepare_maintenance_decision_insert();
drop trigger if exists maintenance_warranty_claims_prepare on public.maintenance_warranty_claims;
create trigger maintenance_warranty_claims_prepare
  before insert on public.maintenance_warranty_claims
  for each row execute function public.prepare_maintenance_decision_insert();

create or replace function public.validate_maintenance_warranty_claim_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.work_order_id is not null and not exists (
    select 1 from public.maintenance_work_orders w
    where w.organization_id = new.organization_id
      and w.id = new.work_order_id
      and w.vehicle_id = new.vehicle_id
  ) then
    raise exception 'Work order does not belong to the selected vehicle.';
  end if;
  if new.maintenance_record_id is not null and not exists (
    select 1 from public.maintenance_records r
    where r.organization_id = new.organization_id
      and r.id = new.maintenance_record_id
      and r.vehicle_id = new.vehicle_id
  ) then
    raise exception 'Maintenance record does not belong to the selected vehicle.';
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_maintenance_warranty_claim_source()
  from public, anon, authenticated;
drop trigger if exists maintenance_warranty_claims_source_guard on public.maintenance_warranty_claims;
create trigger maintenance_warranty_claims_source_guard
  before insert or update of work_order_id, maintenance_record_id, vehicle_id
  on public.maintenance_warranty_claims
  for each row execute function public.validate_maintenance_warranty_claim_source();

create or replace function public.audit_maintenance_warranty_claim_creation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.maintenance_warranty_claim_events (
    organization_id, warranty_claim_id, to_status, notes, metadata, created_by
  ) values (
    new.organization_id, new.id, 'draft', 'Warranty claim created.',
    jsonb_build_object(
      'work_order_id', new.work_order_id,
      'maintenance_record_id', new.maintenance_record_id,
      'vehicle_id', new.vehicle_id
    ),
    new.created_by
  );
  return new;
end;
$$;
revoke execute on function public.audit_maintenance_warranty_claim_creation()
  from public, anon, authenticated;
drop trigger if exists maintenance_warranty_claims_creation_event on public.maintenance_warranty_claims;
create trigger maintenance_warranty_claims_creation_event
  after insert on public.maintenance_warranty_claims
  for each row execute function public.audit_maintenance_warranty_claim_creation();

create or replace function public.prevent_maintenance_warranty_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Warranty claim audit records are immutable.';
end;
$$;
revoke execute on function public.prevent_maintenance_warranty_event_mutation() from public, anon, authenticated;
drop trigger if exists maintenance_warranty_claim_events_immutable on public.maintenance_warranty_claim_events;
create trigger maintenance_warranty_claim_events_immutable
  before update or delete on public.maintenance_warranty_claim_events
  for each row execute function public.prevent_maintenance_warranty_event_mutation();

create or replace function public.maintenance_warranty_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'draft' then p_to in ('submitted', 'closed')
    when 'submitted' then p_to in ('under_review', 'approved', 'partially_approved', 'denied')
    when 'under_review' then p_to in ('approved', 'partially_approved', 'denied')
    when 'approved' then p_to in ('paid', 'closed')
    when 'partially_approved' then p_to in ('paid', 'closed')
    when 'denied' then p_to = 'closed'
    when 'paid' then p_to = 'closed'
    else false
  end
$$;
revoke execute on function public.maintenance_warranty_transition_allowed(text, text)
  from public, anon, authenticated;

create or replace function public.transition_maintenance_warranty_claim(
  p_claim_id uuid,
  p_to_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_user uuid := auth.uid();
  v_claim public.maintenance_warranty_claims%rowtype;
  v_now timestamptz := now();
begin
  if v_org is null or v_user is null or not (select public.is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  select * into v_claim
  from public.maintenance_warranty_claims
  where organization_id = v_org and id = p_claim_id
  for update;
  if not found then raise exception 'Warranty claim not found.'; end if;
  if not public.maintenance_warranty_transition_allowed(v_claim.status, p_to_status) then
    raise exception 'Invalid warranty claim transition: % -> %', v_claim.status, p_to_status;
  end if;
  if p_to_status = 'submitted'
     and (v_claim.submitted_date is null or v_claim.submitted_amount is null or v_claim.submitted_amount <= 0) then
    raise exception 'Submitted date and amount are required.';
  end if;
  if p_to_status = 'approved'
     and (v_claim.approved_amount is null or v_claim.approved_amount <= 0) then
    raise exception 'Approved amount is required.';
  end if;
  if p_to_status = 'partially_approved'
     and (
       v_claim.approved_amount is null
       or v_claim.approved_amount <= 0
       or v_claim.submitted_amount is null
       or v_claim.approved_amount >= v_claim.submitted_amount
     ) then
    raise exception 'A partial approval must be positive and below the submitted amount.';
  end if;
  if p_to_status = 'denied' and length(btrim(coalesce(v_claim.denial_reason, ''))) < 3 then
    raise exception 'Denial reason is required.';
  end if;
  if p_to_status = 'paid'
     and (v_claim.received_amount is null or v_claim.received_amount <= 0) then
    raise exception 'Received amount is required before marking paid.';
  end if;

  update public.maintenance_warranty_claims
  set status = p_to_status,
      closed_by = case when p_to_status = 'closed' then v_user else null end,
      closed_at = case when p_to_status = 'closed' then v_now else null end
  where organization_id = v_org and id = p_claim_id;

  insert into public.maintenance_warranty_claim_events (
    organization_id, warranty_claim_id, from_status, to_status, notes, metadata, created_by
  ) values (
    v_org, p_claim_id, v_claim.status, p_to_status, nullif(btrim(p_notes), ''),
    jsonb_build_object(
      'submitted_amount', v_claim.submitted_amount,
      'approved_amount', v_claim.approved_amount,
      'received_amount', v_claim.received_amount
    ),
    v_user
  );
  return jsonb_build_object('claim_id', p_claim_id, 'from_status', v_claim.status, 'to_status', p_to_status);
end;
$$;
revoke execute on function public.transition_maintenance_warranty_claim(uuid, text, text)
  from public, anon;
grant execute on function public.transition_maintenance_warranty_claim(uuid, text, text)
  to authenticated;

create or replace function public.get_maintenance_budget_performance(p_year integer)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_org is null or v_user is null then raise exception 'Authentication required.'; end if;
  if p_year < 2000 or p_year > 2200 then raise exception 'Invalid budget year.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'fiscal_year', b.fiscal_year,
    'month', b.month,
    'scope', b.scope,
    'vehicle_id', b.vehicle_id,
    'category', b.category,
    'vendor', b.vendor,
    'budget_amount', b.budget_amount,
    'notes', b.notes,
    'actual', coalesce(a.actual, 0),
    'committed', coalesce(c.committed, 0)
  ) order by b.scope, b.month nulls first), '[]'::jsonb)
  into v_result
  from public.maintenance_budgets b
  left join lateral (
    select sum(greatest(0, coalesce(f.total_cost, 0))) as actual
    from public.maintenance_cost_fact_v f
    where f.organization_id = v_org
      and f.cost_date >= make_date(b.fiscal_year, coalesce(b.month, 1), 1)
      and f.cost_date < case
        when b.month is null then make_date(b.fiscal_year + 1, 1, 1)
        else (make_date(b.fiscal_year, b.month, 1) + interval '1 month')::date
      end
      and (b.scope <> 'vehicle' or f.vehicle_id = b.vehicle_id)
      and (b.scope <> 'category' or f.category = b.category)
      and (b.scope <> 'vendor' or lower(btrim(coalesce(f.shop, ''))) = lower(btrim(b.vendor)))
  ) a on true
  left join lateral (
    select sum(greatest(0, coalesce(w.approved_cost_limit, w.estimated_cost, 0))) as committed
    from public.maintenance_work_orders w
    where w.organization_id = v_org
      and w.status not in ('completed', 'invoiced', 'closed', 'cancelled')
      and w.approval_state in ('approved', 'not_required')
      and w.created_at >= make_date(b.fiscal_year, coalesce(b.month, 1), 1)::timestamptz
      and w.created_at < case
        when b.month is null then make_date(b.fiscal_year + 1, 1, 1)::timestamptz
        else (make_date(b.fiscal_year, b.month, 1) + interval '1 month')::timestamptz
      end
      and (b.scope <> 'vehicle' or w.vehicle_id = b.vehicle_id)
      and (b.scope <> 'category')
      and (b.scope <> 'vendor' or lower(btrim(coalesce(w.shop_vendor, ''))) = lower(btrim(b.vendor)))
  ) c on true
  where b.organization_id = v_org and b.fiscal_year = p_year;
  return v_result;
end;
$$;
revoke execute on function public.get_maintenance_budget_performance(integer) from public, anon;
grant execute on function public.get_maintenance_budget_performance(integer) to authenticated;

create or replace function public.get_maintenance_decision_analytics(p_as_of date default current_date)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_user uuid := auth.uid();
  v_daily numeric := 600;
  v_settings jsonb;
  v_vendors jsonb;
  v_vehicles jsonb;
begin
  if v_org is null or v_user is null then raise exception 'Authentication required.'; end if;
  select coalesce(s.maintenance_average_daily_contribution, 600),
         jsonb_build_object(
           'average_daily_contribution', coalesce(s.maintenance_average_daily_contribution, 600),
           'replacement_cost_12m_threshold', coalesce(s.maintenance_replacement_cost_12m_threshold, 30000),
           'replacement_cpm_threshold', coalesce(s.maintenance_replacement_cpm_threshold, 0.35),
           'replacement_downtime_days_threshold', coalesce(s.maintenance_replacement_downtime_days_threshold, 30),
           'replacement_vehicle_age_years_threshold', coalesce(s.maintenance_replacement_vehicle_age_years_threshold, 8)
         )
  into v_daily, v_settings
  from public.settings s where s.organization_id = v_org;
  v_daily := coalesce(v_daily, 600);
  v_settings := coalesce(v_settings, jsonb_build_object(
    'average_daily_contribution', 600,
    'replacement_cost_12m_threshold', 30000,
    'replacement_cpm_threshold', 0.35,
    'replacement_downtime_days_threshold', 30,
    'replacement_vehicle_age_years_threshold', 8
  ));

  with cost_rows as (
    select f.*,
      lag(f.cost_date) over (
        partition by lower(btrim(coalesce(f.shop, ''))), f.vehicle_id, f.service_key
        order by f.cost_date
      ) as previous_same_repair_date
    from public.maintenance_cost_fact_v f
    where f.organization_id = v_org
      and f.cost_date >= (p_as_of - interval '12 months')::date
      and f.cost_date <= p_as_of
  ),
  vendor_costs as (
    select lower(btrim(shop)) as vendor_key,
      min(shop) as vendor,
      sum(greatest(0, coalesce(total_cost, 0))) as total_spend,
      avg(greatest(0, coalesce(total_cost, 0))) as average_repair_cost,
      avg(greatest(0, coalesce(downtime_days, 0))) as average_downtime_days,
      count(*) filter (
        where previous_same_repair_date is not null
          and cost_date - previous_same_repair_date <= 30
      )::numeric / nullif(count(*), 0) as repeat_repair_rate,
      count(*) filter (
        where coalesce(cr.towing_cost, 0) + coalesce(cr.road_service_cost, 0) > 0
          and exists (
            select 1 from cost_rows previous
            where lower(btrim(previous.shop)) is not distinct from lower(btrim(cr.shop))
              and previous.vehicle_id = cr.vehicle_id
              and previous.cost_date < cr.cost_date
              and previous.cost_date >= cr.cost_date - 30
          )
      ) as road_calls
    from cost_rows cr
    where nullif(btrim(cr.shop), '') is not null
    group by lower(btrim(cr.shop))
  ),
  vendor_work_orders as (
    select lower(btrim(shop_vendor)) as vendor_key,
      count(*) filter (where status not in ('completed', 'invoiced', 'closed', 'cancelled')) as open_work_orders,
      avg(
        case when final_cost is not null and estimated_cost > 0
          then (final_cost - estimated_cost) / estimated_cost
        end
      ) as estimate_to_final_variance
    from public.maintenance_work_orders
    where organization_id = v_org and nullif(btrim(shop_vendor), '') is not null
    group by lower(btrim(shop_vendor))
  ),
  vendor_warranty as (
    select lower(btrim(vendor_manufacturer)) as vendor_key,
      sum(coalesce(received_amount, 0)) as warranty_recovery
    from public.maintenance_warranty_claims
    where organization_id = v_org
    group by lower(btrim(vendor_manufacturer))
  ),
  keys as (
    select vendor_key from vendor_costs
    union select vendor_key from vendor_work_orders
    union select vendor_key from vendor_warranty
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'vendor', coalesce(vc.vendor, k.vendor_key),
    'total_spend', coalesce(vc.total_spend, 0),
    'average_repair_cost', coalesce(vc.average_repair_cost, 0),
    'repeat_repair_rate', coalesce(vc.repeat_repair_rate, 0),
    'average_downtime_days', coalesce(vc.average_downtime_days, 0),
    'estimate_to_final_variance', coalesce(vw.estimate_to_final_variance, 0),
    'warranty_recovery', coalesce(vr.warranty_recovery, 0),
    'road_calls_after_repair', coalesce(vc.road_calls, 0),
    'open_work_orders', coalesce(vw.open_work_orders, 0)
  ) order by coalesce(vc.total_spend, 0) desc), '[]'::jsonb)
  into v_vendors
  from keys k
  left join vendor_costs vc using (vendor_key)
  left join vendor_work_orders vw using (vendor_key)
  left join vendor_warranty vr using (vendor_key);

  with costs as (
    select f.*,
      lag(f.cost_date) over (partition by f.vehicle_id, f.service_key order by f.cost_date) as previous_same_repair_date
    from public.maintenance_cost_fact_v f
    where f.organization_id = v_org
      and f.cost_date >= (p_as_of - interval '12 months')::date
      and f.cost_date <= p_as_of
  ),
  cost_agg as (
    select vehicle_id,
      sum(greatest(0, coalesce(total_cost, 0))) filter (where cost_date >= (p_as_of - interval '3 months')::date) as cost_3m,
      sum(greatest(0, coalesce(total_cost, 0))) filter (where cost_date >= (p_as_of - interval '6 months')::date) as cost_6m,
      sum(greatest(0, coalesce(total_cost, 0))) as cost_12m,
      sum(greatest(0, coalesce(cpm_cost, 0))) as cpm_cost_12m,
      sum(greatest(0, coalesce(downtime_days, 0))) as downtime_days_12m,
      sum(greatest(0, coalesce(hotel_travel_cost, 0))) as travel_hotel_12m,
      sum(greatest(0, coalesce(towing_cost, 0) + coalesce(road_service_cost, 0))) as towing_road_12m,
      count(*) filter (
        where previous_same_repair_date is not null
          and cost_date - previous_same_repair_date <= 30
      ) as repeat_repairs_12m
    from costs group by vehicle_id
  ),
  miles as (
    select vehicle_id, sum(coalesce(miles_driven, 0)) as miles_12m
    from public.vehicle_mileage_period_snapshots
    where organization_id = v_org
      and period_end >= (p_as_of - interval '12 months')::date
      and period_start <= p_as_of
    group by vehicle_id
  ),
  open_repairs as (
    select vehicle_id,
      sum(greatest(0, coalesce(approved_cost_limit, estimated_cost, 0))) as open_estimated_repairs,
      sum(case
        when downtime_start is not null then greatest(
          0,
          extract(epoch from (least(now(), (p_as_of + 1)::timestamptz) - downtime_start)) / 86400.0
        )
        else 0
      end) as open_downtime_days
    from public.maintenance_work_orders
    where organization_id = v_org
      and status not in ('completed', 'invoiced', 'closed', 'cancelled')
    group by vehicle_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'vehicle_id', v.id,
    'unit_number', v.unit_number,
    'current_mileage', v.current_mileage,
    'vehicle_age_years', case when v.year is null then null else greatest(0, extract(year from p_as_of)::integer - v.year) end,
    'maintenance_cost_3m', coalesce(c.cost_3m, 0),
    'maintenance_cost_6m', coalesce(c.cost_6m, 0),
    'maintenance_cost_12m', coalesce(c.cost_12m, 0),
    'miles_12m', coalesce(m.miles_12m, 0),
    'cpm_12m', case when coalesce(m.miles_12m, 0) > 0 then coalesce(c.cpm_cost_12m, 0) / m.miles_12m else null end,
    'downtime_days_12m', coalesce(c.downtime_days_12m, 0) + coalesce(o.open_downtime_days, 0),
    'repeat_repairs_12m', coalesce(c.repeat_repairs_12m, 0),
    'open_estimated_repairs', coalesce(o.open_estimated_repairs, 0),
    'direct_maintenance_cost', coalesce(c.cpm_cost_12m, 0),
    'travel_hotel_impact', coalesce(c.travel_hotel_12m, 0),
    'towing_road_service_impact', coalesce(c.towing_road_12m, 0),
    'estimated_lost_contribution', (coalesce(c.downtime_days_12m, 0) + coalesce(o.open_downtime_days, 0)) * v_daily,
    'total_estimated_operational_impact',
      coalesce(c.cpm_cost_12m, 0)
      + coalesce(c.travel_hotel_12m, 0)
      + coalesce(c.towing_road_12m, 0)
      + (coalesce(c.downtime_days_12m, 0) + coalesce(o.open_downtime_days, 0)) * v_daily
  ) order by coalesce(c.cost_12m, 0) desc), '[]'::jsonb)
  into v_vehicles
  from public.vehicles v
  left join cost_agg c on c.vehicle_id = v.id
  left join miles m on m.vehicle_id = v.id
  left join open_repairs o on o.vehicle_id = v.id
  where v.organization_id = v_org
    and v.status in ('active', 'in_repair', 'yard_hometime');

  return jsonb_build_object('settings', v_settings, 'vendors', v_vendors, 'vehicles', v_vehicles);
end;
$$;
revoke execute on function public.get_maintenance_decision_analytics(date) from public, anon;
grant execute on function public.get_maintenance_decision_analytics(date) to authenticated;

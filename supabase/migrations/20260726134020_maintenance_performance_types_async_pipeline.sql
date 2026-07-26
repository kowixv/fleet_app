-- PR4: set-based maintenance analytics, partial-period mileage, async invoice
-- processing, stable pagination indexes, and bulk program installation.

-- ---------------------------------------------------------------------------
-- Query support
-- ---------------------------------------------------------------------------

create index if not exists maintenance_records_org_performed_created_id_idx
  on public.maintenance_records (
    organization_id,
    performed_date desc nulls last,
    created_at desc,
    id desc
  )
  include (vehicle_id, category, planned, status)
  where deleted_at is null and undone_at is null;

create index if not exists vehicle_mileage_logs_org_vehicle_effective_id_idx
  on public.vehicle_mileage_logs (
    organization_id,
    vehicle_id,
    effective_date desc nulls last,
    logged_at desc,
    id desc
  )
  include (mileage, source);

create index if not exists vehicle_inspections_org_created_id_idx
  on public.vehicle_inspections (organization_id, created_at desc, id desc)
  include (vehicle_id, status, inspection_date);

create index if not exists inspection_findings_org_created_id_idx
  on public.inspection_findings (organization_id, created_at desc, id desc)
  include (vehicle_id, status, severity, work_order_id);

create index if not exists maintenance_work_orders_org_updated_id_idx
  on public.maintenance_work_orders (organization_id, updated_at desc, id desc)
  include (vehicle_id, status, priority, assigned_user_id);

drop index if exists public.maintenance_invoices_org_created_idx;
create index maintenance_invoices_org_created_idx
  on public.maintenance_invoices (organization_id, created_at desc, id desc)
  include (status, vehicle_id, invoice_date);

-- ---------------------------------------------------------------------------
-- Authoritative partial-period mileage
-- ---------------------------------------------------------------------------

create or replace function public.get_maintenance_period_mileage(
  p_start date,
  p_end date,
  p_vehicle_id uuid default null
)
returns table (
  vehicle_id uuid,
  miles_driven numeric,
  mileage_source text,
  estimated boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_org uuid := (select public.current_org_id());
begin
  if v_org is null then
    raise exception 'Organization is required.';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Valid mileage period is required.';
  end if;
  if p_vehicle_id is not null and not exists (
    select 1
    from public.vehicles v
    where v.organization_id = v_org and v.id = p_vehicle_id
  ) then
    raise exception 'Vehicle does not belong to organization.';
  end if;

  return query
  with vehicle_scope as (
    select v.id
    from public.vehicles v
    where v.organization_id = v_org
      and (p_vehicle_id is null or v.id = p_vehicle_id)
      and (
        p_vehicle_id is not null
        or v.status in ('active', 'in_repair', 'yard_hometime')
      )
  ),
  boundaries as (
    select
      v.id as vehicle_id,
      sb.mileage as start_before_mileage,
      sb.log_date as start_before_date,
      sa.mileage as start_after_mileage,
      sa.log_date as start_after_date,
      eb.mileage as end_before_mileage,
      eb.log_date as end_before_date,
      ea.mileage as end_after_mileage,
      ea.log_date as end_after_date
    from vehicle_scope v
    left join lateral (
      select l.mileage, coalesce(l.effective_date, l.logged_at::date) as log_date
      from public.vehicle_mileage_logs l
      where l.organization_id = v_org
        and l.vehicle_id = v.id
        and coalesce(l.effective_date, l.logged_at::date) <= p_start
      order by coalesce(l.effective_date, l.logged_at::date) desc, l.logged_at desc, l.id desc
      limit 1
    ) sb on true
    left join lateral (
      select l.mileage, coalesce(l.effective_date, l.logged_at::date) as log_date
      from public.vehicle_mileage_logs l
      where l.organization_id = v_org
        and l.vehicle_id = v.id
        and coalesce(l.effective_date, l.logged_at::date) >= p_start
      order by coalesce(l.effective_date, l.logged_at::date), l.logged_at, l.id
      limit 1
    ) sa on true
    left join lateral (
      select l.mileage, coalesce(l.effective_date, l.logged_at::date) as log_date
      from public.vehicle_mileage_logs l
      where l.organization_id = v_org
        and l.vehicle_id = v.id
        and coalesce(l.effective_date, l.logged_at::date) <= p_end
      order by coalesce(l.effective_date, l.logged_at::date) desc, l.logged_at desc, l.id desc
      limit 1
    ) eb on true
    left join lateral (
      select l.mileage, coalesce(l.effective_date, l.logged_at::date) as log_date
      from public.vehicle_mileage_logs l
      where l.organization_id = v_org
        and l.vehicle_id = v.id
        and coalesce(l.effective_date, l.logged_at::date) >= p_end
      order by coalesce(l.effective_date, l.logged_at::date), l.logged_at, l.id
      limit 1
    ) ea on true
  ),
  interpolated as (
    select
      b.*,
      case
        when b.start_before_date = p_start then b.start_before_mileage
        when b.start_after_date = p_start then b.start_after_mileage
        when b.start_before_date is not null
          and b.start_after_date is not null
          and b.start_after_date > b.start_before_date
          and b.start_after_mileage >= b.start_before_mileage
        then b.start_before_mileage
          + (b.start_after_mileage - b.start_before_mileage)
          * ((p_start - b.start_before_date)::numeric
            / (b.start_after_date - b.start_before_date)::numeric)
        else null
      end as start_value,
      case
        when b.end_before_date = p_end then b.end_before_mileage
        when b.end_after_date = p_end then b.end_after_mileage
        when b.end_before_date is not null
          and b.end_after_date is not null
          and b.end_after_date > b.end_before_date
          and b.end_after_mileage >= b.end_before_mileage
        then b.end_before_mileage
          + (b.end_after_mileage - b.end_before_mileage)
          * ((p_end - b.end_before_date)::numeric
            / (b.end_after_date - b.end_before_date)::numeric)
        else null
      end as end_value
    from boundaries b
  ),
  snapshot_miles as (
    select
      v.id as vehicle_id,
      sum(
        s.miles_driven
        * (
          greatest(
            0,
            least(p_end, s.period_end) - greatest(p_start, s.period_start) + 1
          )::numeric
          / nullif((s.period_end - s.period_start + 1)::numeric, 0)
        )
      ) as miles
    from vehicle_scope v
    join public.vehicle_mileage_period_snapshots s
      on s.organization_id = v_org
     and s.vehicle_id = v.id
     and s.period_start <= p_end
     and s.period_end >= p_start
     and s.miles_driven is not null
    group by v.id
  ),
  load_miles as (
    select
      v.id as vehicle_id,
      sum(coalesce(l.total_miles, coalesce(l.loaded_miles, 0) + coalesce(l.empty_miles, 0), 0)) as miles
    from vehicle_scope v
    join public.loads l
      on l.organization_id = v_org
     and l.vehicle_id = v.id
     and l.delivery_date between p_start and p_end
     and l.status in ('booked', 'delivered', 'paid')
    group by v.id
  )
  select
    i.vehicle_id,
    round(
      greatest(
        0,
        case
          when i.start_value is not null
            and i.end_value is not null
            and i.end_value >= i.start_value
          then i.end_value - i.start_value
          when sm.miles is not null then sm.miles
          else coalesce(lm.miles, 0)
        end
      ),
      2
    ) as miles_driven,
    case
      when i.start_value is not null
        and i.end_value is not null
        and i.end_value >= i.start_value
      then case
        when i.start_before_date = p_start and i.end_before_date = p_end
          then 'mileage_logs'
        else 'mileage_logs_interpolated'
      end
      when sm.miles is not null then 'period_snapshots_prorated'
      when lm.miles is not null then 'loads'
      else 'unavailable'
    end as mileage_source,
    case
      when i.start_value is not null
        and i.end_value is not null
        and i.end_value >= i.start_value
      then not (i.start_before_date = p_start and i.end_before_date = p_end)
      when sm.miles is not null then true
      else false
    end as estimated
  from interpolated i
  left join snapshot_miles sm on sm.vehicle_id = i.vehicle_id
  left join load_miles lm on lm.vehicle_id = i.vehicle_id;
end;
$$;

revoke execute on function public.get_maintenance_period_mileage(date,date,uuid)
  from public, anon;
grant execute on function public.get_maintenance_period_mileage(date,date,uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Set-based cost analytics. No row cap is used for aggregate inputs.
-- ---------------------------------------------------------------------------

create or replace function public.get_maintenance_cost_analytics_v2(
  p_start date,
  p_end date,
  p_vehicle_id uuid default null,
  p_category text default null,
  p_planned boolean default null,
  p_shop text default null,
  p_status text default null,
  p_average_daily_contribution numeric default 0
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_result jsonb;
begin
  if v_org is null then
    raise exception 'Organization is required.';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Valid analytics period is required.';
  end if;
  if p_vehicle_id is not null and not exists (
    select 1 from public.vehicles
    where organization_id = v_org and id = p_vehicle_id
  ) then
    raise exception 'Vehicle does not belong to organization.';
  end if;

  with filtered as materialized (
    select f.*
    from public.maintenance_cost_fact_v f
    where f.organization_id = v_org
      and f.cost_date between p_start and p_end
      and (p_vehicle_id is null or f.vehicle_id = p_vehicle_id)
      and (p_category is null or f.category = p_category)
      and (p_planned is null or f.planned = p_planned)
      and (p_shop is null or f.shop = p_shop)
      and (p_status is null or f.status = p_status)
  ),
  mileage as materialized (
    select *
    from public.get_maintenance_period_mileage(p_start, p_end, p_vehicle_id)
  ),
  repeat_rows as (
    select
      vehicle_id,
      source_record_id,
      cost_date,
      cost_date - lag(cost_date) over (
        partition by vehicle_id, service_key
        order by cost_date, source_record_id
      ) as days_since_previous
    from filtered
    where vehicle_id is not null and service_key is not null and cost_date is not null
  ),
  fleet as (
    select
      count(*)::bigint as total_count,
      coalesce(sum(total_cost), 0)::numeric as total_cost,
      coalesce(sum(cpm_cost), 0)::numeric as cpm_cost,
      coalesce(sum(total_cost) filter (where planned), 0)::numeric as planned_cost,
      coalesce(sum(total_cost) filter (where not planned), 0)::numeric as unscheduled_cost,
      coalesce(sum(abs(warranty_recovery)), 0)::numeric as warranty_recovery,
      coalesce(sum(towing_cost + road_service_cost), 0)::numeric as towing_road_service_cost,
      coalesce(sum(downtime_days), 0)::numeric as downtime_days,
      coalesce(sum(total_breakdown_impact), 0)::numeric as total_breakdown_impact,
      coalesce(sum(cpm_cost - towing_cost - road_service_cost), 0)::numeric as direct_maintenance_cost,
      coalesce(sum(hotel_travel_cost), 0)::numeric as travel_hotel_impact,
      coalesce(sum(total_cost) filter (where category = 'tires'), 0)::numeric as tire_cost,
      count(*) filter (where towing_cost + road_service_cost > 0)::numeric as road_calls
    from filtered
  ),
  mileage_total as (
    select
      coalesce(sum(miles_driven), 0)::numeric as miles,
      count(*) filter (where estimated)::integer as estimated_vehicle_count,
      count(*) filter (where mileage_source = 'unavailable')::integer as unavailable_vehicle_count,
      coalesce((
        select jsonb_object_agg(source_rows.mileage_source, source_rows.source_count)
        from (
          select m2.mileage_source, count(*) as source_count
          from mileage m2
          group by m2.mileage_source
        ) source_rows
      ), '{}'::jsonb) as sources
    from mileage
  ),
  category_rows as (
    select category, sum(total_cost)::numeric as total_cost
    from filtered
    group by category
  ),
  shop_rows as (
    select coalesce(shop, 'Unknown') as shop, sum(total_cost)::numeric as total_cost
    from filtered
    group by coalesce(shop, 'Unknown')
  ),
  unit_base as (
    select
      f.vehicle_id,
      max(f.unit_number) as unit_number,
      sum(f.total_cost)::numeric as total_cost,
      sum(f.cpm_cost)::numeric as cpm_cost,
      sum(f.total_cost) filter (where f.planned)::numeric as planned_cost,
      sum(f.total_cost) filter (where not f.planned)::numeric as unscheduled_cost,
      sum(f.downtime_days)::numeric as downtime_days,
      sum(f.total_cost) filter (where f.category = 'tires')::numeric as tire_cost,
      count(*) filter (where f.towing_cost + f.road_service_cost > 0)::numeric as road_calls
    from filtered f
    where f.vehicle_id is not null
    group by f.vehicle_id
  ),
  unit_rows as (
    select
      u.*,
      coalesce(m.miles_driven, 0)::numeric as miles_driven,
      m.mileage_source,
      coalesce(m.estimated, false) as mileage_estimated,
      coalesce(r.repeat_repairs, 0)::integer as repeat_repairs
    from unit_base u
    left join mileage m on m.vehicle_id = u.vehicle_id
    left join (
      select vehicle_id, count(*)::integer as repeat_repairs
      from repeat_rows
      where days_since_previous between 0 and 30
      group by vehicle_id
    ) r on r.vehicle_id = u.vehicle_id
  ),
  shop_options as (
    select distinct f.shop
    from public.maintenance_cost_fact_v f
    where f.organization_id = v_org
      and f.cost_date between p_start and p_end
      and f.shop is not null
      and (p_vehicle_id is null or f.vehicle_id = p_vehicle_id)
      and (p_category is null or f.category = p_category)
      and (p_planned is null or f.planned = p_planned)
      and (p_status is null or f.status = p_status)
  )
  select jsonb_build_object(
    'totalCount', fleet.total_count,
    'dataComplete', true,
    'partialDataWarning', null,
    'totalCost', fleet.total_cost,
    'cpmCost', fleet.cpm_cost,
    'fleetCpm', case when mileage_total.miles > 0 then fleet.cpm_cost / mileage_total.miles else null end,
    'milesDriven', mileage_total.miles,
    'insufficientMileage', mileage_total.miles <= 0,
    'mileageEstimatedVehicleCount', mileage_total.estimated_vehicle_count,
    'mileageUnavailableVehicleCount', mileage_total.unavailable_vehicle_count,
    'mileageSources', mileage_total.sources,
    'plannedCost', fleet.planned_cost,
    'unscheduledCost', fleet.unscheduled_cost,
    'warrantyRecovery', fleet.warranty_recovery,
    'towingRoadServiceCost', fleet.towing_road_service_cost,
    'downtimeDays', fleet.downtime_days,
    'tireCostPerThousand', case when mileage_total.miles > 0 then fleet.tire_cost / mileage_total.miles * 1000 else null end,
    'roadCallsPer100k', case when mileage_total.miles > 0 then fleet.road_calls / mileage_total.miles * 100000 else null end,
    'repeatRepairRate30Days',
      case when fleet.total_count > 0
        then (select count(*)::numeric from repeat_rows where days_since_previous between 0 and 30) / fleet.total_count
        else 0
      end,
    'totalBreakdownImpact', fleet.total_breakdown_impact,
    'directMaintenanceCost', fleet.direct_maintenance_cost,
    'travelHotelImpact', fleet.travel_hotel_impact,
    'estimatedLostContribution', fleet.downtime_days * greatest(coalesce(p_average_daily_contribution, 0), 0),
    'totalEstimatedOperationalImpact',
      fleet.direct_maintenance_cost
      + fleet.travel_hotel_impact
      + fleet.towing_road_service_cost
      + fleet.downtime_days * greatest(coalesce(p_average_daily_contribution, 0), 0),
    'byCategory', coalesce((
      select jsonb_agg(
        jsonb_build_object('category', category, 'totalCost', total_cost)
        order by total_cost desc, category
      )
      from category_rows
    ), '[]'::jsonb),
    'byShop', coalesce((
      select jsonb_agg(
        jsonb_build_object('shop', shop, 'totalCost', total_cost)
        order by total_cost desc, shop
      )
      from shop_rows
    ), '[]'::jsonb),
    'shopOptions', coalesce((
      select jsonb_agg(shop order by shop)
      from shop_options
    ), '[]'::jsonb),
    'unitRanking', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'vehicle_id', vehicle_id,
          'unit_number', unit_number,
          'totalCost', total_cost,
          'cpmCost', cpm_cost,
          'milesDriven', miles_driven,
          'cpm', case when miles_driven > 0 then cpm_cost / miles_driven else null end,
          'insufficientMileage', miles_driven <= 0,
          'mileageSource', mileage_source,
          'mileageEstimated', mileage_estimated,
          'plannedCost', coalesce(planned_cost, 0),
          'unscheduledCost', coalesce(unscheduled_cost, 0),
          'tireCostPerThousand', case when miles_driven > 0 then coalesce(tire_cost, 0) / miles_driven * 1000 else null end,
          'roadCallsPer100k', case when miles_driven > 0 then road_calls / miles_driven * 100000 else null end,
          'downtimeDays', coalesce(downtime_days, 0),
          'repeatRepairs', repeat_repairs
        )
        order by
          case when miles_driven > 0 then cpm_cost / miles_driven else null end desc nulls last,
          total_cost desc,
          vehicle_id
      )
      from unit_rows
    ), '[]'::jsonb)
  )
  into v_result
  from fleet
  cross join mileage_total;

  return v_result;
end;
$$;

revoke execute on function public.get_maintenance_cost_analytics_v2(
  date,date,uuid,text,boolean,text,text,numeric
) from public, anon;
grant execute on function public.get_maintenance_cost_analytics_v2(
  date,date,uuid,text,boolean,text,text,numeric
) to authenticated;

-- ---------------------------------------------------------------------------
-- Async maintenance invoice pipeline
-- ---------------------------------------------------------------------------

alter table public.maintenance_invoices
  add column if not exists pipeline_status text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists max_retries integer not null default 3,
  add column if not exists last_error text,
  add column if not exists queued_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.maintenance_invoices
set pipeline_status = case status
  when 'pending_review' then 'pending_review'
  when 'failed' then 'failed'
  when 'cancelled' then 'cancelled'
  else 'completed'
end
where pipeline_status is null;

alter table public.maintenance_invoices
  alter column pipeline_status set default 'uploaded',
  alter column pipeline_status set not null;

alter table public.maintenance_invoices
  drop constraint if exists maintenance_invoices_pipeline_status_chk;
alter table public.maintenance_invoices
  add constraint maintenance_invoices_pipeline_status_chk
  check (pipeline_status in (
    'uploaded', 'queued', 'extracting', 'parsing',
    'pending_review', 'completed', 'failed', 'cancelled'
  ));

alter table public.maintenance_invoices
  drop constraint if exists maintenance_invoices_retry_shape_chk;
alter table public.maintenance_invoices
  add constraint maintenance_invoices_retry_shape_chk
  check (
    retry_count between 0 and 20
    and max_retries between 1 and 20
    and (lease_token is null) = (lease_expires_at is null)
  );

create or replace function public.sync_maintenance_invoice_pipeline_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status
    and new.pipeline_status is not distinct from old.pipeline_status then
    new.pipeline_status := case new.status
      when 'pending_review' then 'pending_review'
      when 'completed' then 'completed'
      when 'failed' then 'failed'
      when 'cancelled' then 'cancelled'
      else new.pipeline_status
    end;
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_maintenance_invoice_pipeline_status()
  from public, anon, authenticated;

drop trigger if exists maintenance_invoices_pipeline_status_sync on public.maintenance_invoices;
create trigger maintenance_invoices_pipeline_status_sync
  before update on public.maintenance_invoices
  for each row execute function public.sync_maintenance_invoice_pipeline_status();

drop trigger if exists maintenance_invoices_updated_at on public.maintenance_invoices;
create trigger maintenance_invoices_updated_at
  before update on public.maintenance_invoices
  for each row execute function public.touch_maintenance_updated_at();

create index if not exists maintenance_invoices_pipeline_claim_idx
  on public.maintenance_invoices (
    pipeline_status,
    next_attempt_at,
    lease_expires_at,
    queued_at,
    id
  )
  include (organization_id, retry_count, max_retries, storage_path)
  where pipeline_status in ('uploaded', 'queued', 'extracting', 'parsing', 'failed');

create or replace function public.claim_maintenance_invoice_jobs(
  p_limit integer default 5,
  p_lease_seconds integer default 300
)
returns table (
  id uuid,
  organization_id uuid,
  storage_path text,
  file_name text,
  lease_token uuid,
  retry_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.';
  end if;
  if p_limit < 1 or p_limit > 25 then
    raise exception 'Worker batch limit must be between 1 and 25.';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 1800 then
    raise exception 'Lease must be between 30 and 1800 seconds.';
  end if;

  return query
  with candidates as (
    select i.id
    from public.maintenance_invoices i
    where (
      i.pipeline_status in ('uploaded', 'queued')
      or (
        i.pipeline_status = 'failed'
        and i.retry_count < i.max_retries
      )
      or (
        i.pipeline_status in ('extracting', 'parsing')
        and i.lease_expires_at < now()
      )
    )
      and coalesce(i.next_attempt_at, now()) <= now()
      and i.retry_count < i.max_retries
    order by coalesce(i.next_attempt_at, i.queued_at, i.created_at), i.id
    for update skip locked
    limit p_limit
  )
  update public.maintenance_invoices i
  set
    pipeline_status = 'extracting',
    status = case when i.status in ('completed', 'cancelled') then i.status else 'failed' end,
    lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    processing_started_at = now(),
    retry_count = i.retry_count + 1,
    last_error = null
  from candidates c
  where i.id = c.id
  returning
    i.id,
    i.organization_id,
    i.storage_path,
    i.file_name,
    i.lease_token,
    i.retry_count;
end;
$$;

revoke execute on function public.claim_maintenance_invoice_jobs(integer,integer)
  from public, anon, authenticated;
grant execute on function public.claim_maintenance_invoice_jobs(integer,integer)
  to service_role;

create or replace function public.mark_maintenance_invoice_job_parsing(
  p_invoice_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.';
  end if;
  update public.maintenance_invoices
  set pipeline_status = 'parsing'
  where id = p_invoice_id
    and lease_token = p_lease_token
    and pipeline_status = 'extracting'
    and lease_expires_at > now();
  return found;
end;
$$;

revoke execute on function public.mark_maintenance_invoice_job_parsing(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.mark_maintenance_invoice_job_parsing(uuid,uuid)
  to service_role;

create or replace function public.complete_maintenance_invoice_job(
  p_invoice_id uuid,
  p_lease_token uuid,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Parsed invoice payload is required.';
  end if;

  update public.maintenance_invoices i
  set
    vehicle_id = case
      when nullif(p_payload->>'vehicle_id', '') is null then null
      else (
        select v.id
        from public.vehicles v
        where v.organization_id = i.organization_id
          and v.id = nullif(p_payload->>'vehicle_id', '')::uuid
      )
    end,
    invoice_number = nullif(btrim(p_payload->>'invoice_number'), ''),
    invoice_date = nullif(p_payload->>'invoice_date', '')::date,
    shop_name = nullif(btrim(p_payload->>'shop_name'), ''),
    raw_text = coalesce(p_payload->>'raw_text', ''),
    parsed_data = coalesce(p_payload->'parsed_data', '{}'::jsonb),
    parser_confidence = nullif(p_payload->>'parser_confidence', '')::numeric,
    parser_warnings = coalesce(
      array(select jsonb_array_elements_text(coalesce(p_payload->'parser_warnings', '[]'::jsonb))),
      '{}'::text[]
    ),
    status = 'pending_review',
    pipeline_status = 'pending_review',
    processed_at = now(),
    next_attempt_at = null,
    last_error = null,
    lease_token = null,
    lease_expires_at = null
  where i.id = p_invoice_id
    and i.lease_token = p_lease_token
    and i.pipeline_status in ('extracting', 'parsing')
    and i.lease_expires_at > now()
    and (
      nullif(p_payload->>'vehicle_id', '') is null
      or exists (
        select 1
        from public.vehicles v
        where v.organization_id = i.organization_id
          and v.id = nullif(p_payload->>'vehicle_id', '')::uuid
      )
    );

  return found;
end;
$$;

revoke execute on function public.complete_maintenance_invoice_job(uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_maintenance_invoice_job(uuid,uuid,jsonb)
  to service_role;

create or replace function public.fail_maintenance_invoice_job(
  p_invoice_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retryable boolean default true
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.';
  end if;

  update public.maintenance_invoices i
  set
    pipeline_status = case
      when p_retryable and i.retry_count < i.max_retries then 'queued'
      else 'failed'
    end,
    status = 'failed',
    last_error = left(regexp_replace(coalesce(p_error, 'Unknown processing error.'), '[[:cntrl:]]+', ' ', 'g'), 1000),
    next_attempt_at = case
      when p_retryable and i.retry_count < i.max_retries
      then now() + make_interval(secs => least(3600, (60 * power(2, greatest(i.retry_count - 1, 0)))::integer))
      else null
    end,
    processed_at = case
      when not p_retryable or i.retry_count >= i.max_retries then now()
      else i.processed_at
    end,
    lease_token = null,
    lease_expires_at = null
  where i.id = p_invoice_id
    and i.lease_token = p_lease_token
    and i.pipeline_status in ('extracting', 'parsing')
  returning i.pipeline_status into v_status;

  return v_status;
end;
$$;

revoke execute on function public.fail_maintenance_invoice_job(uuid,uuid,text,boolean)
  from public, anon, authenticated;
grant execute on function public.fail_maintenance_invoice_job(uuid,uuid,text,boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- One application call; one database transaction; itemized outcomes.
-- ---------------------------------------------------------------------------

create or replace function public.install_maintenance_program_bulk(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_user uuid := auth.uid();
  v_item jsonb;
  v_results jsonb := '[]'::jsonb;
  v_rule_id uuid;
  v_vehicle public.vehicles%rowtype;
  v_vehicle_id uuid;
  v_vehicle_type text;
  v_service_type text;
  v_preset_id text;
  v_title text;
  v_interval_miles numeric;
  v_interval_days integer;
  v_interval_hours numeric;
  v_interval_type text;
  v_engine_hours numeric;
  v_created boolean;
begin
  if v_org is null or not (select public.is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(p_payload->'items') <> 'array' then
    raise exception 'Bulk maintenance items are required.';
  end if;
  if jsonb_array_length(p_payload->'items') < 1
    or jsonb_array_length(p_payload->'items') > 250 then
    raise exception 'Bulk maintenance item count must be between 1 and 250.';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_payload->'items')
  loop
    v_preset_id := left(coalesce(nullif(btrim(v_item->>'preset_id'), ''), 'unknown'), 120);
    v_title := left(coalesce(nullif(btrim(v_item->>'title'), ''), v_preset_id), 160);
    v_vehicle_id := null;
    v_vehicle_type := null;
    v_service_type := null;
    v_interval_miles := null;
    v_interval_days := null;
    v_interval_hours := null;
    v_rule_id := null;
    v_created := false;
    v_vehicle := null;

    begin
      v_vehicle_id := nullif(v_item->>'vehicle_id', '')::uuid;
      v_vehicle_type := nullif(btrim(v_item->>'vehicle_type'), '');
      v_service_type := nullif(btrim(v_item->>'service_type'), '');
      v_interval_miles := nullif(v_item->>'interval_miles', '')::numeric;
      v_interval_days := nullif(v_item->>'interval_days', '')::integer;
      v_interval_hours := nullif(v_item->>'interval_engine_hours', '')::numeric;
      if v_service_type is null
        or length(v_service_type) < 2
        or length(v_service_type) > 120
        or v_service_type ~ '[[:cntrl:]]' then
        raise exception 'Valid maintenance type is required.';
      end if;
      if v_interval_miles is null
        and v_interval_days is null
        and v_interval_hours is null then
        raise exception 'At least one interval is required.';
      end if;
      if (v_interval_miles is not null and (v_interval_miles <= 0 or v_interval_miles <> trunc(v_interval_miles)))
        or (v_interval_days is not null and v_interval_days <= 0)
        or (v_interval_hours is not null and (v_interval_hours <= 0 or v_interval_hours <> trunc(v_interval_hours))) then
        raise exception 'Intervals must be positive whole numbers.';
      end if;
      if v_interval_miles is null and v_interval_days is null then
        raise exception 'Engine-hours-only reminders are not supported.';
      end if;
      v_interval_type := case when v_interval_miles is not null then 'mileage' else 'date' end;

      if v_vehicle_id is null then
        if v_vehicle_type not in ('truck', 'box_truck') then
          raise exception 'Valid vehicle type is required.';
        end if;

        perform pg_advisory_xact_lock(
          hashtextextended(
            v_org::text || ':' || v_vehicle_type || ':' ||
            public.manual_maintenance_service_key('periodic', v_service_type),
            0
          )
        );

        select r.id into v_rule_id
        from public.maintenance_rules r
        where r.organization_id = v_org
          and r.vehicle_id is null
          and r.vehicle_type = v_vehicle_type
          and r.active = true
          and public.manual_maintenance_service_key('periodic', r.service_type)
            = public.manual_maintenance_service_key('periodic', v_service_type)
        limit 1
        for update;

        if v_rule_id is null then
          insert into public.maintenance_rules (
            organization_id, vehicle_id, vehicle_type, service_type, interval_type,
            interval_miles, interval_days, interval_engine_hours,
            last_done_mileage, last_done_date, last_done_engine_hours,
            active, template_source, template_applied_by, template_applied_at
          )
          values (
            v_org, null, v_vehicle_type, v_service_type, v_interval_type,
            v_interval_miles, v_interval_days, v_interval_hours,
            null, null, null,
            true, 'maintenance_program_installer', v_user, now()
          )
          returning id into v_rule_id;

          insert into public.maintenance_rule_vehicle_states (
            organization_id, rule_id, vehicle_id,
            last_done_mileage, last_done_date, last_done_engine_hours
          )
          select
            v_org,
            v_rule_id,
            v.id,
            case when v_interval_miles is not null then v.current_mileage else null end,
            case when v_interval_days is not null then current_date else null end,
            case when v_interval_hours is not null then p.engine_hours else null end
          from public.vehicles v
          left join public.vehicle_maintenance_profiles p
            on p.organization_id = v.organization_id and p.vehicle_id = v.id
          where v.organization_id = v_org
            and v.vehicle_type = v_vehicle_type
            and v.status in ('active', 'in_repair', 'yard_hometime')
          on conflict (organization_id, rule_id, vehicle_id) do nothing;
          v_created := true;
        end if;
      else
        select * into v_vehicle
        from public.vehicles v
        where v.organization_id = v_org
          and v.id = v_vehicle_id
          and v.status in ('active', 'in_repair', 'yard_hometime')
        for update;
        if not found then
          raise exception 'Active vehicle not found.';
        end if;

        perform pg_advisory_xact_lock(
          hashtextextended(
            v_org::text || ':' || v_vehicle_id::text || ':' ||
            public.manual_maintenance_service_key('periodic', v_service_type),
            0
          )
        );

        select r.id into v_rule_id
        from public.maintenance_rules r
        where r.organization_id = v_org
          and r.vehicle_id = v_vehicle_id
          and r.active = true
          and public.manual_maintenance_service_key('periodic', r.service_type)
            = public.manual_maintenance_service_key('periodic', v_service_type)
        limit 1
        for update;

        if v_rule_id is null then
          select p.engine_hours into v_engine_hours
          from public.vehicle_maintenance_profiles p
          where p.organization_id = v_org and p.vehicle_id = v_vehicle_id;

          insert into public.maintenance_rules (
            organization_id, vehicle_id, vehicle_type, service_type, interval_type,
            interval_miles, interval_days, interval_engine_hours,
            last_done_mileage, last_done_date, last_done_engine_hours,
            active, template_source, template_applied_by, template_applied_at
          )
          values (
            v_org, v_vehicle_id, null, v_service_type, v_interval_type,
            v_interval_miles, v_interval_days, v_interval_hours,
            case when v_interval_miles is not null then v_vehicle.current_mileage else null end,
            case when v_interval_days is not null then current_date else null end,
            case when v_interval_hours is not null then v_engine_hours else null end,
            true, 'maintenance_program_installer', v_user, now()
          )
          returning id into v_rule_id;
          v_created := true;
        end if;
      end if;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'presetId', v_preset_id,
        'title', v_title,
        'vehicleId', v_vehicle_id,
        'unitNumber', case when v_vehicle_id is null then null else v_vehicle.unit_number end,
        'ruleId', v_rule_id,
        'status', case when v_created then 'created' else 'skipped' end,
        'message', case when v_created then 'Oluşturuldu.' else 'Zaten mevcut.' end
      ));
    exception when others then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'presetId', v_preset_id,
        'title', v_title,
        'vehicleId', v_vehicle_id,
        'unitNumber', case when v_vehicle_id is null then null else v_vehicle.unit_number end,
        'status', 'failed',
        'message', left(regexp_replace(sqlerrm, '[[:cntrl:]]+', ' ', 'g'), 500)
      ));
    end;
  end loop;

  return jsonb_build_object(
    'created', (select count(*) from jsonb_array_elements(v_results) x where x->>'status' = 'created'),
    'skipped', (select count(*) from jsonb_array_elements(v_results) x where x->>'status' = 'skipped'),
    'failed', (select count(*) from jsonb_array_elements(v_results) x where x->>'status' = 'failed'),
    'results', v_results
  );
end;
$$;

revoke execute on function public.install_maintenance_program_bulk(jsonb)
  from public, anon;
grant execute on function public.install_maintenance_program_bulk(jsonb)
  to authenticated;

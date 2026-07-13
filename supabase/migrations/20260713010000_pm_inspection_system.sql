-- PM inspection system: reusable checklists, drafts, immutable completed results, findings.
-- File-only migration artifact; run manually in Supabase SQL Editor.

insert into storage.buckets (id, name, public)
values ('inspection-files', 'inspection-files', false)
on conflict (id) do nothing;

create table if not exists inspection_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  inspection_type text not null,
  description text,
  version integer not null default 1,
  source_template_id uuid,
  active boolean not null default true,
  created_by uuid references profiles (id) on delete set null,
  updated_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_templates_type_chk check (inspection_type in ('driver_daily','weekly_safety','pm_a','pm_b','heavy_6_month','annual','custom')),
  constraint inspection_templates_org_name_version_key unique (organization_id, name, version),
  constraint inspection_templates_org_id_id_key unique (organization_id, id)
);

create table if not exists inspection_template_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  template_id uuid not null,
  section text not null,
  label text not null,
  input_type text not null,
  unit_of_measure text,
  required boolean not null default false,
  warning_threshold numeric,
  critical_threshold numeric,
  axle_position text not null default '',
  select_options text[] not null default '{}'::text[],
  instructions text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_template_items_input_type_chk check (input_type in ('pass_fail','checkbox','number','text','select')),
  constraint inspection_template_items_org_template_label_key unique (organization_id, template_id, label, axle_position),
  constraint inspection_template_items_org_id_id_key unique (organization_id, id)
);

alter table inspection_template_items
  drop constraint if exists inspection_template_items_template_same_org_fk;
alter table inspection_template_items
  add constraint inspection_template_items_template_same_org_fk
  foreign key (organization_id, template_id)
  references inspection_templates (organization_id, id) on delete cascade not valid;

alter table inspection_templates
  drop constraint if exists inspection_templates_source_same_org_fk;
alter table inspection_templates
  add constraint inspection_templates_source_same_org_fk
  foreign key (organization_id, source_template_id)
  references inspection_templates (organization_id, id) on delete set null not valid;

create table if not exists vehicle_inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id) on delete cascade,
  template_id uuid references inspection_templates (id) on delete set null,
  maintenance_rule_id uuid references maintenance_rules (id) on delete set null,
  maintenance_record_id uuid references maintenance_records (id) on delete set null,
  inspection_type text not null,
  inspection_date date not null default current_date,
  mileage numeric,
  engine_hours numeric,
  inspector text,
  shop text,
  status text not null default 'draft',
  notes text,
  mark_rule_serviced boolean not null default false,
  completed_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  updated_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_inspections_status_chk check (status in ('draft','completed','failed')),
  constraint vehicle_inspections_type_chk check (inspection_type in ('driver_daily','weekly_safety','pm_a','pm_b','heavy_6_month','annual','custom')),
  constraint vehicle_inspections_org_id_id_key unique (organization_id, id)
);

alter table vehicle_inspections
  drop constraint if exists vehicle_inspections_vehicle_same_org_fk;
alter table vehicle_inspections
  add constraint vehicle_inspections_vehicle_same_org_fk
  foreign key (organization_id, vehicle_id)
  references vehicles (organization_id, id) on delete cascade not valid;
alter table vehicle_inspections
  drop constraint if exists vehicle_inspections_template_same_org_fk;
alter table vehicle_inspections
  add constraint vehicle_inspections_template_same_org_fk
  foreign key (organization_id, template_id)
  references inspection_templates (organization_id, id) on delete set null not valid;
alter table vehicle_inspections
  drop constraint if exists vehicle_inspections_rule_same_org_fk;
alter table vehicle_inspections
  add constraint vehicle_inspections_rule_same_org_fk
  foreign key (organization_id, maintenance_rule_id)
  references maintenance_rules (organization_id, id) on delete set null not valid;
alter table vehicle_inspections
  drop constraint if exists vehicle_inspections_record_same_org_fk;
alter table vehicle_inspections
  add constraint vehicle_inspections_record_same_org_fk
  foreign key (organization_id, maintenance_record_id)
  references maintenance_records (organization_id, id) on delete set null not valid;

create table if not exists vehicle_inspection_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  inspection_id uuid not null,
  template_item_id uuid,
  template_version integer not null,
  section text not null,
  label text not null,
  input_type text not null,
  unit_of_measure text,
  axle_position text,
  value_text text,
  value_number numeric,
  value_bool boolean,
  passed boolean,
  notes text,
  photo_storage_path text,
  created_at timestamptz not null default now(),
  constraint vehicle_inspection_results_input_type_chk check (input_type in ('pass_fail','checkbox','number','text','select')),
  constraint vehicle_inspection_results_org_id_id_key unique (organization_id, id)
);

alter table vehicle_inspection_results
  drop constraint if exists vehicle_inspection_results_inspection_same_org_fk;
alter table vehicle_inspection_results
  add constraint vehicle_inspection_results_inspection_same_org_fk
  foreign key (organization_id, inspection_id)
  references vehicle_inspections (organization_id, id) on delete cascade not valid;
alter table vehicle_inspection_results
  drop constraint if exists vehicle_inspection_results_template_item_same_org_fk;
alter table vehicle_inspection_results
  add constraint vehicle_inspection_results_template_item_same_org_fk
  foreign key (organization_id, template_item_id)
  references inspection_template_items (organization_id, id) on delete set null not valid;

create table if not exists inspection_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  inspection_id uuid not null,
  result_id uuid,
  vehicle_id uuid not null references vehicles (id) on delete cascade,
  severity text not null,
  status text not null default 'open',
  section text,
  label text,
  axle_position text,
  measurement numeric,
  threshold numeric,
  notes text,
  recommended_action text,
  photo_storage_path text,
  work_order_status text,
  work_order_notes text,
  work_order_created_by uuid references profiles (id) on delete set null,
  work_order_created_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_findings_severity_chk check (severity in ('monitor','service_soon','critical','do_not_dispatch')),
  constraint inspection_findings_status_chk check (status in ('open','acknowledged','closed')),
  constraint inspection_findings_work_order_status_chk check (work_order_status is null or work_order_status in ('draft','cancelled')),
  constraint inspection_findings_org_id_id_key unique (organization_id, id)
);

alter table inspection_findings
  drop constraint if exists inspection_findings_inspection_same_org_fk;
alter table inspection_findings
  add constraint inspection_findings_inspection_same_org_fk
  foreign key (organization_id, inspection_id)
  references vehicle_inspections (organization_id, id) on delete cascade not valid;
alter table inspection_findings
  drop constraint if exists inspection_findings_result_same_org_fk;
alter table inspection_findings
  add constraint inspection_findings_result_same_org_fk
  foreign key (organization_id, result_id)
  references vehicle_inspection_results (organization_id, id) on delete cascade not valid;
alter table inspection_findings
  drop constraint if exists inspection_findings_vehicle_same_org_fk;
alter table inspection_findings
  add constraint inspection_findings_vehicle_same_org_fk
  foreign key (organization_id, vehicle_id)
  references vehicles (organization_id, id) on delete cascade not valid;

create index if not exists idx_inspection_templates_org_active on inspection_templates (organization_id, active, inspection_type);
create index if not exists idx_inspection_template_items_template on inspection_template_items (organization_id, template_id, active, sort_order);
create index if not exists idx_vehicle_inspections_org_vehicle_status on vehicle_inspections (organization_id, vehicle_id, status, inspection_date desc);
create index if not exists idx_vehicle_inspection_results_org_vehicle_history on vehicle_inspection_results (organization_id, label, axle_position, created_at desc);
create unique index if not exists vehicle_inspection_results_one_draft_value_idx
  on vehicle_inspection_results (organization_id, inspection_id, template_item_id)
  where template_item_id is not null;
create index if not exists idx_inspection_findings_org_vehicle_open on inspection_findings (organization_id, vehicle_id, status, severity);

alter table maintenance_template_items add column if not exists default_inspection_template_id uuid;
alter table maintenance_template_items
  drop constraint if exists maintenance_template_items_default_inspection_template_same_org_fk;
alter table maintenance_template_items
  add constraint maintenance_template_items_default_inspection_template_same_org_fk
  foreign key (organization_id, default_inspection_template_id)
  references inspection_templates (organization_id, id) on delete set null not valid;

alter table inspection_templates enable row level security;
alter table inspection_template_items enable row level security;
alter table vehicle_inspections enable row level security;
alter table vehicle_inspection_results enable row level security;
alter table inspection_findings enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'inspection_templates',
    'inspection_template_items',
    'vehicle_inspections',
    'vehicle_inspection_results',
    'inspection_findings'
  ] loop
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

create or replace function prevent_completed_inspection_result_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from vehicle_inspections
    where organization_id = coalesce(old.organization_id, new.organization_id)
      and id = coalesce(old.inspection_id, new.inspection_id)
      and status = 'completed'
  ) then
    raise exception 'Completed inspection results are immutable.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists vehicle_inspection_results_immutable_update on vehicle_inspection_results;
create trigger vehicle_inspection_results_immutable_update
  before update on vehicle_inspection_results
  for each row execute function prevent_completed_inspection_result_changes();
drop trigger if exists vehicle_inspection_results_immutable_delete on vehicle_inspection_results;
create trigger vehicle_inspection_results_immutable_delete
  before delete on vehicle_inspection_results
  for each row execute function prevent_completed_inspection_result_changes();

drop trigger if exists inspection_templates_updated_at on inspection_templates;
create trigger inspection_templates_updated_at before update on inspection_templates
  for each row execute function touch_maintenance_updated_at();
drop trigger if exists inspection_template_items_updated_at on inspection_template_items;
create trigger inspection_template_items_updated_at before update on inspection_template_items
  for each row execute function touch_maintenance_updated_at();
drop trigger if exists vehicle_inspections_updated_at on vehicle_inspections;
create trigger vehicle_inspections_updated_at before update on vehicle_inspections
  for each row execute function touch_maintenance_updated_at();
drop trigger if exists inspection_findings_updated_at on inspection_findings;
create trigger inspection_findings_updated_at before update on inspection_findings
  for each row execute function touch_maintenance_updated_at();

create or replace function seed_default_inspection_templates(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template uuid;
  v_type text;
  v_name text;
  v_version int := 1;
  v_items jsonb;
  v_item jsonb;
begin
  if p_organization_id is null then raise exception 'organization_id is required.'; end if;

  for v_type, v_name, v_items in
    select * from (values
      ('driver_daily', 'Driver daily/pre-trip', '[
        {"section":"Safety","label":"Tire bulge/separation","input_type":"pass_fail","required":true,"instructions":"Fail if bulge, separation, exposed cord, or unsafe damage is present."},
        {"section":"Safety","label":"Lights","input_type":"pass_fail","required":true},
        {"section":"Safety","label":"Brake air leaks","input_type":"pass_fail","required":true},
        {"section":"Measurements","label":"Tire tread depth","input_type":"number","unit_of_measure":"32nds","required":true,"warning_threshold":6,"critical_threshold":4,"axle_position":"all positions"}
      ]'::jsonb),
      ('weekly_safety', 'Weekly safety check', '[
        {"section":"Safety","label":"Hub oil and wheel seals","input_type":"pass_fail","required":true},
        {"section":"Safety","label":"Brake remaining percentage","input_type":"number","unit_of_measure":"%","required":true,"warning_threshold":25,"critical_threshold":15,"axle_position":"by axle"},
        {"section":"Electrical","label":"Battery CCA","input_type":"number","unit_of_measure":"CCA","warning_threshold":650,"critical_threshold":550}
      ]'::jsonb),
      ('pm_a', 'PM-A', '[
        {"section":"Fluids","label":"Engine oil level","input_type":"pass_fail","required":true},
        {"section":"Fluids","label":"Coolant level and visible leaks","input_type":"pass_fail","required":true},
        {"section":"Emissions","label":"DEF condition/crystallization","input_type":"pass_fail","required":true},
        {"section":"Leaks","label":"Engine/fuel/coolant leaks","input_type":"pass_fail","required":true},
        {"section":"Air Intake","label":"Air-filter restriction","input_type":"number","unit_of_measure":"in H2O","warning_threshold":20,"critical_threshold":25},
        {"section":"Engine","label":"Belts, tensioner and idlers","input_type":"pass_fail","required":true},
        {"section":"Engine","label":"Hoses and clamps","input_type":"pass_fail","required":true},
        {"section":"Electrical","label":"Battery/cables","input_type":"pass_fail","required":true},
        {"section":"Electrical","label":"Battery CCA","input_type":"number","unit_of_measure":"CCA","warning_threshold":650,"critical_threshold":550},
        {"section":"Coupling","label":"Fifth-wheel condition and lubrication","input_type":"pass_fail","required":true},
        {"section":"Wheel End","label":"Hub oil and wheel seals","input_type":"pass_fail","required":true,"instructions":"Critical if hot/leaking wheel end is found."},
        {"section":"Air Brake","label":"Brake air leaks","input_type":"pass_fail","required":true,"instructions":"Critical if severe air leak is found."},
        {"section":"Air Brake","label":"Brake stroke or remaining percentage","input_type":"number","unit_of_measure":"%","warning_threshold":25,"critical_threshold":15,"axle_position":"by axle"},
        {"section":"Suspension/Steering","label":"Suspension and steering","input_type":"pass_fail","required":true},
        {"section":"Driveline","label":"Driveshaft/U-joints","input_type":"pass_fail","required":true},
        {"section":"Tires","label":"Tire tread depth","input_type":"number","unit_of_measure":"32nds","warning_threshold":6,"critical_threshold":4,"axle_position":"by position"},
        {"section":"Lights","label":"Lights","input_type":"pass_fail","required":true},
        {"section":"Diagnostics","label":"Fault codes","input_type":"text"},
        {"section":"Emissions","label":"Regen frequency","input_type":"number","unit_of_measure":"miles between regens","warning_threshold":300,"critical_threshold":150},
        {"section":"Emissions","label":"DPF differential pressure","input_type":"number","unit_of_measure":"kPa","warning_threshold":5,"critical_threshold":8},
        {"section":"Consumption","label":"Oil consumption","input_type":"number","unit_of_measure":"qt","warning_threshold":2,"critical_threshold":4},
        {"section":"Consumption","label":"Coolant added since last inspection","input_type":"number","unit_of_measure":"gal","warning_threshold":0.5,"critical_threshold":1},
        {"section":"Metrics","label":"Engine hours","input_type":"number","unit_of_measure":"hours"},
        {"section":"Metrics","label":"Idle percentage","input_type":"number","unit_of_measure":"%","warning_threshold":35,"critical_threshold":50},
        {"section":"Metrics","label":"MPG","input_type":"number","unit_of_measure":"mpg","warning_threshold":5,"critical_threshold":4}
      ]'::jsonb),
      ('pm_b', 'PM-B', '[
        {"section":"PM-B","label":"PM-A checklist completed","input_type":"checkbox","required":true},
        {"section":"Filters","label":"Fuel filter condition","input_type":"pass_fail","required":true},
        {"section":"Air Dryer","label":"Air dryer condition","input_type":"pass_fail"},
        {"section":"Measurements","label":"Air-pressure loss","input_type":"number","unit_of_measure":"psi/min","warning_threshold":2,"critical_threshold":3}
      ]'::jsonb),
      ('heavy_6_month', '6-month heavy inspection', '[
        {"section":"Inspection","label":"Heavy inspection completed","input_type":"checkbox","required":true},
        {"section":"Wheel End","label":"Hot/leaking wheel end","input_type":"pass_fail","required":true},
        {"section":"Brakes","label":"Brake remaining percentage","input_type":"number","unit_of_measure":"%","warning_threshold":25,"critical_threshold":15,"axle_position":"by axle"}
      ]'::jsonb),
      ('annual', 'Annual inspection', '[
        {"section":"DOT","label":"DOT annual inspection completed","input_type":"checkbox","required":true},
        {"section":"DOT","label":"Annual inspection date","input_type":"text","required":true},
        {"section":"Safety","label":"Active severe derate","input_type":"pass_fail","required":true}
      ]'::jsonb)
    ) as seed(inspection_type, name, items)
  loop
    insert into inspection_templates (organization_id, name, inspection_type, description, version, active)
    values (p_organization_id, v_name, v_type, 'Default editable Peterbilt 579 PM checklist seed.', v_version, true)
    on conflict (organization_id, name, version) do update set
      inspection_type = excluded.inspection_type,
      active = true,
      updated_at = now()
    returning id into v_template;

    for v_item in select value from jsonb_array_elements(v_items)
    loop
      insert into inspection_template_items (
        organization_id, template_id, section, label, input_type, unit_of_measure,
        required, warning_threshold, critical_threshold, axle_position,
        instructions, sort_order, active
      ) values (
        p_organization_id, v_template, v_item->>'section', v_item->>'label',
        v_item->>'input_type', nullif(v_item->>'unit_of_measure', ''),
        coalesce((v_item->>'required')::boolean, false),
        nullif(v_item->>'warning_threshold', '')::numeric,
        nullif(v_item->>'critical_threshold', '')::numeric,
        coalesce(nullif(v_item->>'axle_position', ''), ''),
        nullif(v_item->>'instructions', ''),
        coalesce((select count(*) from inspection_template_items where organization_id = p_organization_id and template_id = v_template), 0) + 10,
        true
      )
      on conflict (organization_id, template_id, label, axle_position) do update set
        section = excluded.section,
        input_type = excluded.input_type,
        unit_of_measure = excluded.unit_of_measure,
        required = excluded.required,
        warning_threshold = excluded.warning_threshold,
        critical_threshold = excluded.critical_threshold,
        instructions = excluded.instructions,
        active = true,
        updated_at = now();
    end loop;
  end loop;
end;
$$;

revoke execute on function seed_default_inspection_templates(uuid) from public, anon;
grant execute on function seed_default_inspection_templates(uuid) to authenticated, service_role;

select seed_default_inspection_templates(id) from organizations;

create or replace function seed_default_inspection_templates_for_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_default_inspection_templates(new.id);
  return new;
end;
$$;

drop trigger if exists organizations_seed_default_inspection_templates on organizations;
create trigger organizations_seed_default_inspection_templates
  after insert on organizations
  for each row execute function seed_default_inspection_templates_for_org();

create or replace function start_vehicle_inspection(
  p_vehicle_id uuid,
  p_template_id uuid,
  p_maintenance_rule_id uuid default null,
  p_maintenance_record_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
  v_template inspection_templates%rowtype;
  v_existing uuid;
  v_id uuid;
begin
  if v_org is null or not (select is_org_writer()) then raise exception 'Write permission required.'; end if;
  if not exists (select 1 from vehicles where organization_id = v_org and id = p_vehicle_id) then
    raise exception 'Vehicle does not belong to organization.';
  end if;
  select * into v_template from inspection_templates where organization_id = v_org and id = p_template_id and active = true;
  if not found then raise exception 'Inspection template not found.'; end if;

  select id into v_existing
  from vehicle_inspections
  where organization_id = v_org and vehicle_id = p_vehicle_id and template_id = p_template_id and status = 'draft'
  order by updated_at desc
  limit 1;
  if v_existing is not null then return v_existing; end if;

  insert into vehicle_inspections (
    organization_id, vehicle_id, template_id, maintenance_rule_id, maintenance_record_id,
    inspection_type, inspection_date, status, created_by, updated_by
  ) values (
    v_org, p_vehicle_id, p_template_id, p_maintenance_rule_id, p_maintenance_record_id,
    v_template.inspection_type, current_date, 'draft', v_user, v_user
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function start_vehicle_inspection(uuid,uuid,uuid,uuid) from public, anon;
grant execute on function start_vehicle_inspection(uuid,uuid,uuid,uuid) to authenticated;

create or replace function save_vehicle_inspection_draft(
  p_inspection_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
  v_inspection vehicle_inspections%rowtype;
  v_result jsonb;
  v_item inspection_template_items%rowtype;
begin
  if v_org is null or not (select is_org_writer()) then raise exception 'Write permission required.'; end if;

  select * into v_inspection
  from vehicle_inspections
  where id = p_inspection_id and organization_id = v_org and status = 'draft'
  for update;
  if not found then raise exception 'Draft inspection not found.'; end if;

  update vehicle_inspections
  set
    inspection_date = coalesce(nullif(p_payload->>'inspection_date', '')::date, inspection_date),
    inspector = nullif(btrim(p_payload->>'inspector'), ''),
    shop = nullif(btrim(p_payload->>'shop'), ''),
    notes = nullif(btrim(p_payload->>'notes'), ''),
    mark_rule_serviced = coalesce((p_payload->>'mark_rule_serviced')::boolean, mark_rule_serviced),
    updated_by = v_user,
    updated_at = now()
  where id = p_inspection_id and organization_id = v_org and status = 'draft';

  if jsonb_typeof(coalesce(p_payload->'results', '[]'::jsonb)) = 'array' then
    delete from vehicle_inspection_results
    where organization_id = v_org and inspection_id = p_inspection_id;

    for v_result in select value from jsonb_array_elements(coalesce(p_payload->'results', '[]'::jsonb))
    loop
      select * into v_item
      from inspection_template_items
      where organization_id = v_org
        and template_id = v_inspection.template_id
        and id = nullif(v_result->>'template_item_id', '')::uuid
        and active = true;
      if not found then continue; end if;

      insert into vehicle_inspection_results (
        organization_id, inspection_id, template_item_id, template_version,
        section, label, input_type, unit_of_measure, axle_position,
        value_text, value_number, value_bool, passed, notes, photo_storage_path
      ) values (
        v_org, p_inspection_id, v_item.id,
        (select version from inspection_templates where organization_id = v_org and id = v_inspection.template_id),
        v_item.section, v_item.label, v_item.input_type, v_item.unit_of_measure, v_item.axle_position,
        nullif(v_result->>'value_text', ''),
        nullif(v_result->>'value_number', '')::numeric,
        nullif(v_result->>'value_bool', '')::boolean,
        nullif(v_result->>'passed', '')::boolean,
        nullif(v_result->>'notes', ''),
        nullif(v_result->>'photo_storage_path', '')
      );
    end loop;
  end if;

  return p_inspection_id;
end;
$$;

revoke execute on function save_vehicle_inspection_draft(uuid,jsonb) from public, anon;
grant execute on function save_vehicle_inspection_draft(uuid,jsonb) to authenticated;

create or replace function classify_inspection_result(
  p_label text,
  p_input_type text,
  p_passed boolean,
  p_value numeric,
  p_warning numeric,
  p_critical numeric
)
returns text
language plpgsql
immutable
as $$
declare
  v_label text := lower(coalesce(p_label, ''));
begin
  if p_input_type = 'pass_fail' and p_passed = false then
    if v_label like '%tire bulge%' or v_label like '%separation%' or
       v_label like '%severe air leak%' or v_label like '%hot/leaking wheel end%' or
       v_label like '%active severe derate%' or v_label like '%coolant contamination%' then
      return 'do_not_dispatch';
    end if;
    return 'service_soon';
  end if;
  if p_value is not null and p_critical is not null then
    if v_label like '%brake%' or v_label like '%tread%' or v_label like '%battery cca%' or v_label like '%regen frequency%' or v_label like '%mpg%' then
      if p_value <= p_critical then return 'critical'; end if;
    else
      if p_value >= p_critical then return 'critical'; end if;
    end if;
  end if;
  if p_value is not null and p_warning is not null then
    if v_label like '%brake%' or v_label like '%tread%' or v_label like '%battery cca%' or v_label like '%regen frequency%' or v_label like '%mpg%' then
      if p_value <= p_warning then return 'service_soon'; end if;
    else
      if p_value >= p_warning then return 'service_soon'; end if;
    end if;
  end if;
  return null;
end;
$$;

create or replace function complete_vehicle_inspection(
  p_inspection_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
  v_inspection vehicle_inspections%rowtype;
  v_vehicle vehicles%rowtype;
  v_profile vehicle_maintenance_profiles%rowtype;
  v_item inspection_template_items%rowtype;
  v_result jsonb;
  v_result_id uuid;
  v_value_text text;
  v_value_number numeric;
  v_value_bool boolean;
  v_passed boolean;
  v_severity text;
  v_missing text[] := '{}';
  v_record uuid;
begin
  if v_org is null or not (select is_org_writer()) then raise exception 'Write permission required.'; end if;

  select * into v_inspection
  from vehicle_inspections
  where id = p_inspection_id and organization_id = v_org and status = 'draft'
  for update;
  if not found then raise exception 'Draft inspection not found.'; end if;

  select * into v_vehicle
  from vehicles
  where id = v_inspection.vehicle_id and organization_id = v_org
  for update;
  if not found then raise exception 'Vehicle not found.'; end if;

  select * into v_profile
  from vehicle_maintenance_profiles
  where organization_id = v_org and vehicle_id = v_inspection.vehicle_id
  for update;

  delete from vehicle_inspection_results
  where organization_id = v_org and inspection_id = p_inspection_id;

  for v_item in
    select * from inspection_template_items
    where organization_id = v_org and template_id = v_inspection.template_id and active = true
    order by sort_order, label
  loop
    select value into v_result
    from jsonb_array_elements(coalesce(p_payload->'results', '[]'::jsonb))
    where value->>'template_item_id' = v_item.id::text
    limit 1;

    if v_item.required and (
      v_result is null or (
        nullif(v_result->>'value_text', '') is null
        and nullif(v_result->>'value_number', '') is null
        and nullif(v_result->>'value_bool', '') is null
        and nullif(v_result->>'passed', '') is null
      )
    ) then
      v_missing := array_append(v_missing, v_item.label);
      continue;
    end if;

    if v_result is null then continue; end if;
    v_value_text := nullif(v_result->>'value_text', '');
    v_value_number := nullif(v_result->>'value_number', '')::numeric;
    v_value_bool := nullif(v_result->>'value_bool', '')::boolean;
    v_passed := nullif(v_result->>'passed', '')::boolean;

    insert into vehicle_inspection_results (
      organization_id, inspection_id, template_item_id, template_version,
      section, label, input_type, unit_of_measure, axle_position,
      value_text, value_number, value_bool, passed, notes, photo_storage_path
    ) values (
      v_org, p_inspection_id, v_item.id,
      (select version from inspection_templates where organization_id = v_org and id = v_inspection.template_id),
      v_item.section, v_item.label, v_item.input_type, v_item.unit_of_measure, v_item.axle_position,
      v_value_text, v_value_number, v_value_bool, v_passed,
      nullif(v_result->>'notes', ''),
      nullif(v_result->>'photo_storage_path', '')
    ) returning id into v_result_id;

    v_severity := classify_inspection_result(v_item.label, v_item.input_type, v_passed, v_value_number, v_item.warning_threshold, v_item.critical_threshold);
    if v_severity is not null then
      insert into inspection_findings (
        organization_id, inspection_id, result_id, vehicle_id, severity, section, label,
        axle_position, measurement, threshold, notes, recommended_action, photo_storage_path, created_by
      ) values (
        v_org, p_inspection_id, v_result_id, v_inspection.vehicle_id, v_severity,
        v_item.section, v_item.label, v_item.axle_position, v_value_number,
        case when v_severity in ('critical','do_not_dispatch') then v_item.critical_threshold else v_item.warning_threshold end,
        nullif(v_result->>'notes', ''),
        case when v_severity in ('critical','do_not_dispatch') then 'Do not dispatch until reviewed and repaired by authorized personnel.' else 'Monitor or schedule service.' end,
        nullif(v_result->>'photo_storage_path', ''),
        v_user
      );
    end if;
  end loop;

  if array_length(v_missing, 1) is not null then
    raise exception 'Required inspection fields missing: %', array_to_string(v_missing, ', ');
  end if;

  update vehicle_maintenance_profiles
  set
    engine_hours = coalesce(
      (select value_number from vehicle_inspection_results where organization_id = v_org and inspection_id = p_inspection_id and lower(label) = 'engine hours' order by created_at desc limit 1),
      engine_hours
    ),
    idle_percentage = coalesce(
      (select value_number from vehicle_inspection_results where organization_id = v_org and inspection_id = p_inspection_id and lower(label) = 'idle percentage' order by created_at desc limit 1),
      idle_percentage
    ),
    rolling_30_day_mpg = coalesce(
      (select value_number from vehicle_inspection_results where organization_id = v_org and inspection_id = p_inspection_id and lower(label) = 'mpg' order by created_at desc limit 1),
      rolling_30_day_mpg
    ),
    updated_by = v_user,
    updated_at = now()
  where organization_id = v_org and vehicle_id = v_inspection.vehicle_id;

  update vehicle_inspections
  set
    inspection_date = coalesce(nullif(p_payload->>'inspection_date', '')::date, inspection_date),
    mileage = v_vehicle.current_mileage,
    engine_hours = (select engine_hours from vehicle_maintenance_profiles where organization_id = v_org and vehicle_id = v_inspection.vehicle_id),
    inspector = nullif(btrim(coalesce(p_payload->>'inspector', inspector)), ''),
    shop = nullif(btrim(coalesce(p_payload->>'shop', shop)), ''),
    notes = nullif(btrim(coalesce(p_payload->>'notes', notes)), ''),
    status = case when exists (select 1 from inspection_findings where organization_id = v_org and inspection_id = p_inspection_id and severity in ('critical','do_not_dispatch')) then 'failed' else 'completed' end,
    completed_at = now(),
    updated_by = v_user,
    updated_at = now()
  where id = p_inspection_id and organization_id = v_org;

  if coalesce((p_payload->>'mark_rule_serviced')::boolean, v_inspection.mark_rule_serviced) and v_inspection.maintenance_rule_id is not null then
    v_record := mark_maintenance_serviced(v_inspection.maintenance_rule_id, coalesce(nullif(p_payload->>'inspection_date', '')::date, current_date), 0, nullif(p_payload->>'shop', ''), null, 'Completed inspection ' || p_inspection_id::text);
    update vehicle_inspections
    set maintenance_record_id = v_record
    where id = p_inspection_id and organization_id = v_org;
  end if;

  return p_inspection_id;
end;
$$;

revoke execute on function complete_vehicle_inspection(uuid,jsonb) from public, anon;
grant execute on function complete_vehicle_inspection(uuid,jsonb) to authenticated;

create or replace function clone_inspection_template(
  p_template_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
  v_source inspection_templates%rowtype;
  v_new uuid;
begin
  if v_org is null or not (select is_org_writer()) then raise exception 'Write permission required.'; end if;
  select * into v_source from inspection_templates where organization_id = v_org and id = p_template_id;
  if not found then raise exception 'Template not found.'; end if;

  insert into inspection_templates (
    organization_id, name, inspection_type, description, version, source_template_id,
    active, created_by, updated_by
  ) values (
    v_org,
    coalesce(nullif(btrim(p_name), ''), v_source.name || ' Copy'),
    v_source.inspection_type,
    v_source.description,
    1,
    v_source.id,
    true,
    v_user,
    v_user
  ) returning id into v_new;

  insert into inspection_template_items (
    organization_id, template_id, section, label, input_type, unit_of_measure,
    required, warning_threshold, critical_threshold, axle_position, select_options,
    instructions, sort_order, active
  )
  select
    v_org, v_new, section, label, input_type, unit_of_measure,
    required, warning_threshold, critical_threshold, axle_position, select_options,
    instructions, sort_order, active
  from inspection_template_items
  where organization_id = v_org and template_id = p_template_id;

  return v_new;
end;
$$;

revoke execute on function clone_inspection_template(uuid,text) from public, anon;
grant execute on function clone_inspection_template(uuid,text) to authenticated;

create or replace function create_inspection_work_order_draft(
  p_finding_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
begin
  if v_org is null or not (select is_org_writer()) then raise exception 'Write permission required.'; end if;
  update inspection_findings
  set work_order_status = 'draft',
      work_order_notes = nullif(btrim(p_notes), ''),
      work_order_created_by = v_user,
      work_order_created_at = now()
  where id = p_finding_id and organization_id = v_org and status = 'open';
  if not found then raise exception 'Open finding not found.'; end if;
  return p_finding_id;
end;
$$;

revoke execute on function create_inspection_work_order_draft(uuid,text) from public, anon;
grant execute on function create_inspection_work_order_draft(uuid,text) to authenticated;

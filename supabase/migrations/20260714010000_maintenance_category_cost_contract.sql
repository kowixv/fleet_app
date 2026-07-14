-- Maintenance category/cost contract and PM inspection checklist refresh.
-- File-only migration artifact; run manually in Supabase SQL Editor.

alter table maintenance_invoices add column if not exists diagnostic_cost numeric not null default 0;
alter table maintenance_invoices add column if not exists freight_shipping_cost numeric not null default 0;
alter table maintenance_invoices add column if not exists core_charge_cost numeric not null default 0;
alter table maintenance_invoices add column if not exists environmental_fee_cost numeric not null default 0;
alter table maintenance_invoices add column if not exists machine_shop_cost numeric not null default 0;
alter table maintenance_invoices add column if not exists sublet_cost numeric not null default 0;
alter table maintenance_invoices add column if not exists refund_credit numeric not null default 0;
alter table maintenance_invoices add column if not exists cause text;
alter table maintenance_invoices add column if not exists breakdown_occurred boolean not null default false;

alter table maintenance_records add column if not exists diagnostic_cost numeric not null default 0;
alter table maintenance_records add column if not exists freight_shipping_cost numeric not null default 0;
alter table maintenance_records add column if not exists core_charge_cost numeric not null default 0;
alter table maintenance_records add column if not exists environmental_fee_cost numeric not null default 0;
alter table maintenance_records add column if not exists machine_shop_cost numeric not null default 0;
alter table maintenance_records add column if not exists sublet_cost numeric not null default 0;
alter table maintenance_records add column if not exists refund_credit numeric not null default 0;
alter table maintenance_records add column if not exists cause text;
alter table maintenance_records add column if not exists breakdown_occurred boolean not null default false;

alter table inspection_findings add column if not exists diagnostic_cost numeric not null default 0;
alter table inspection_findings add column if not exists freight_shipping_cost numeric not null default 0;
alter table inspection_findings add column if not exists core_charge_cost numeric not null default 0;
alter table inspection_findings add column if not exists environmental_fee_cost numeric not null default 0;
alter table inspection_findings add column if not exists machine_shop_cost numeric not null default 0;
alter table inspection_findings add column if not exists sublet_cost numeric not null default 0;
alter table inspection_findings add column if not exists refund_credit numeric not null default 0;
alter table inspection_findings add column if not exists cause text;
alter table inspection_findings add column if not exists breakdown_occurred boolean not null default false;

do $$
declare
  v_category_check text := '(category in (
    ''preventive_maintenance'',''engine'',''fuel_system'',''turbo_air_intake'',''aftertreatment'',
    ''transmission_clutch'',''driveline_differential'',''cooling_system'',''air_system'',
    ''brakes_wheel_end'',''suspension_steering'',''tires'',''electrical'',''hvac_ac'',''apu'',
    ''cab_body_glass'',''fifth_wheel_coupling'',''trailer'',''dot_inspection'',''other'',
    ''routine_pm'',''transmission_driveline'',''cooling'',''road_service_towing'',''driver_damage'',''warranty_recovery''
  ))';
  v_cause_check text := '(cause is null or cause in (
    ''normal_wear'',''component_failure'',''road_hazard'',''driver_damage'',
    ''accident_collision'',''previous_repair_failure'',''unknown''
  ))';
begin
  alter table maintenance_records drop constraint if exists maintenance_records_category_chk;
  alter table inspection_findings drop constraint if exists inspection_findings_category_chk;
  alter table maintenance_records add constraint maintenance_records_category_chk check (category in (
    'preventive_maintenance','engine','fuel_system','turbo_air_intake','aftertreatment',
    'transmission_clutch','driveline_differential','cooling_system','air_system',
    'brakes_wheel_end','suspension_steering','tires','electrical','hvac_ac','apu',
    'cab_body_glass','fifth_wheel_coupling','trailer','dot_inspection','other',
    'routine_pm','transmission_driveline','cooling','road_service_towing','driver_damage','warranty_recovery'
  )) not valid;
  alter table inspection_findings add constraint inspection_findings_category_chk check (category in (
    'preventive_maintenance','engine','fuel_system','turbo_air_intake','aftertreatment',
    'transmission_clutch','driveline_differential','cooling_system','air_system',
    'brakes_wheel_end','suspension_steering','tires','electrical','hvac_ac','apu',
    'cab_body_glass','fifth_wheel_coupling','trailer','dot_inspection','other',
    'routine_pm','transmission_driveline','cooling','road_service_towing','driver_damage','warranty_recovery'
  )) not valid;

  if not exists (select 1 from pg_constraint where conname = 'maintenance_records_cause_chk') then
    execute 'alter table maintenance_records add constraint maintenance_records_cause_chk check ' || v_cause_check || ' not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'maintenance_invoices_cause_chk') then
    execute 'alter table maintenance_invoices add constraint maintenance_invoices_cause_chk check ' || v_cause_check || ' not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inspection_findings_cause_chk') then
    execute 'alter table inspection_findings add constraint inspection_findings_cause_chk check ' || v_cause_check || ' not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'maintenance_records_extra_costs_chk') then
    alter table maintenance_records add constraint maintenance_records_extra_costs_chk check (
      diagnostic_cost >= 0 and freight_shipping_cost >= 0 and core_charge_cost >= 0
      and environmental_fee_cost >= 0 and machine_shop_cost >= 0 and sublet_cost >= 0
      and refund_credit >= 0
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'maintenance_invoices_extra_costs_chk') then
    alter table maintenance_invoices add constraint maintenance_invoices_extra_costs_chk check (
      diagnostic_cost >= 0 and freight_shipping_cost >= 0 and core_charge_cost >= 0
      and environmental_fee_cost >= 0 and machine_shop_cost >= 0 and sublet_cost >= 0
      and refund_credit >= 0
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inspection_findings_extra_costs_chk') then
    alter table inspection_findings add constraint inspection_findings_extra_costs_chk check (
      diagnostic_cost >= 0 and freight_shipping_cost >= 0 and core_charge_cost >= 0
      and environmental_fee_cost >= 0 and machine_shop_cost >= 0 and sublet_cost >= 0
      and refund_credit >= 0
    ) not valid;
  end if;
end $$;

create or replace function normalize_maintenance_cost_category(p_category text, p_service text default '')
returns text
language sql
immutable
as $$
  select case
    when p_category in (
      'preventive_maintenance','engine','fuel_system','turbo_air_intake','aftertreatment',
      'transmission_clutch','driveline_differential','cooling_system','air_system',
      'brakes_wheel_end','suspension_steering','tires','electrical','hvac_ac','apu',
      'cab_body_glass','fifth_wheel_coupling','trailer','dot_inspection','other'
    ) then p_category
    when p_category = 'routine_pm' then 'preventive_maintenance'
    when p_category = 'cooling' then 'cooling_system'
    when p_category = 'transmission_driveline' and coalesce(p_service, '') ~* '(drive\s?shaft|u-joint|carrier bearing|differential|axle shaft|driveline)' then 'driveline_differential'
    when p_category = 'transmission_driveline' then 'transmission_clutch'
    when coalesce(p_service, '') ~* '(pm|preventive|oil change|wet pm|lubrication|grease|routine service)' then 'preventive_maintenance'
    when coalesce(p_service, '') ~* '(fuel pump|fuel line|fuel rail|fuel filter|fuel water separator)' then 'fuel_system'
    when coalesce(p_service, '') ~* '(turbo|cac|charge air cooler|intercooler|boost leak|intake|air filter)' then 'turbo_air_intake'
    when coalesce(p_service, '') ~* '(dpf|def|scr|regen|nox|doser|aftertreatment)' then 'aftertreatment'
    when coalesce(p_service, '') ~* '(transmission|clutch|shifter|gear|gearbox)' then 'transmission_clutch'
    when coalesce(p_service, '') ~* '(driveshaft|u-joint|carrier bearing|driveline|differential|axle shaft)' then 'driveline_differential'
    when coalesce(p_service, '') ~* '(coolant|radiator|water pump|thermostat|hose|surge tank|egr cooler)' then 'cooling_system'
    when coalesce(p_service, '') ~* '(air compressor|air dryer|air line|air leak|air valve|governor|air tank)' then 'air_system'
    when coalesce(p_service, '') ~* '(brake|drum|rotor|caliper|hub|wheel seal|bearing)' then 'brakes_wheel_end'
    when coalesce(p_service, '') ~* '(suspension|steering|shock|air bag|spring|tie rod|drag link|kingpin|torque rod)' then 'suspension_steering'
    when coalesce(p_service, '') ~* '(tire|tread|steer tire|drive tire)' then 'tires'
    when coalesce(p_service, '') ~* '(battery|alternator|starter|wiring|sensor|light|headlight|connector)' then 'electrical'
    when coalesce(p_service, '') ~* '(a/c|ac|hvac|compressor|condenser|evaporator|blower|refrigerant)' then 'hvac_ac'
    when coalesce(p_service, '') ~* '(apu|auxiliary power unit|tripac|carrier comfortpro)' then 'apu'
    when coalesce(p_service, '') ~* '(windshield|glass|mirror|door|bumper|hood|cab|body panel)' then 'cab_body_glass'
    when coalesce(p_service, '') ~* '(fifth wheel|kingpin lock|coupling|release handle)' then 'fifth_wheel_coupling'
    when coalesce(p_service, '') ~* '(trailer|landing gear|trailer abs|trailer light|trailer door)' then 'trailer'
    when coalesce(p_service, '') ~* '(dot|annual inspection|inspection|federal inspection)' then 'dot_inspection'
    else 'other'
  end
$$;

create or replace view maintenance_cost_fact_v
with (security_invoker = true)
as
select
  r.organization_id,
  r.id as source_record_id,
  'maintenance_record'::text as source_type,
  r.vehicle_id,
  v.unit_number,
  r.invoice_id,
  r.expense_id,
  coalesce(r.invoice_hash, i.file_hash) as invoice_hash,
  r.performed_date as cost_date,
  coalesce(nullif(r.vendor, ''), nullif(r.shop_name, ''), i.shop_name) as shop,
  r.service_type,
  maintenance_service_key(r.service_type) as service_key,
  normalize_maintenance_cost_category(r.category, r.service_type) as category,
  r.planned,
  r.status,
  r.mileage as mileage_at_service,
  r.parts_cost,
  r.labor_cost,
  r.shop_fees,
  r.tax_cost,
  r.towing_cost,
  r.road_service_cost,
  r.hotel_travel_cost,
  r.other_cost,
  r.warranty_recovery,
  coalesce(
    r.total_cost,
    nullif(r.cost, 0),
    r.parts_cost + r.labor_cost + r.diagnostic_cost + r.shop_fees + r.tax_cost +
    r.towing_cost + r.road_service_cost + r.hotel_travel_cost + r.freight_shipping_cost +
    r.core_charge_cost + r.environmental_fee_cost + r.machine_shop_cost + r.sublet_cost +
    r.other_cost - abs(r.warranty_recovery) - abs(r.refund_credit)
  ) as total_cost,
  r.parts_cost + r.labor_cost + r.diagnostic_cost + r.shop_fees + r.tax_cost +
    r.towing_cost + r.road_service_cost + r.freight_shipping_cost + r.core_charge_cost +
    r.environmental_fee_cost + r.machine_shop_cost + r.sublet_cost + r.other_cost -
    abs(r.warranty_recovery) - abs(r.refund_credit) as cpm_cost,
  r.downtime_start,
  r.downtime_end,
  case
    when r.downtime_start is not null and r.downtime_end is not null
      then greatest(0, extract(epoch from (r.downtime_end - r.downtime_start)) / 86400.0)
    else 0
  end as downtime_days,
  r.cause::text as cause,
  r.breakdown_occurred::boolean as breakdown_occurred,
  r.diagnostic_cost::numeric as diagnostic_cost,
  r.freight_shipping_cost::numeric as freight_shipping_cost,
  r.core_charge_cost::numeric as core_charge_cost,
  r.environmental_fee_cost::numeric as environmental_fee_cost,
  r.machine_shop_cost::numeric as machine_shop_cost,
  r.sublet_cost::numeric as sublet_cost,
  r.refund_credit::numeric as refund_credit,
  r.parts_cost + r.labor_cost + r.diagnostic_cost + r.shop_fees + r.tax_cost +
    r.towing_cost + r.road_service_cost + r.freight_shipping_cost + r.core_charge_cost +
    r.environmental_fee_cost + r.machine_shop_cost + r.sublet_cost + r.other_cost -
    abs(r.warranty_recovery) - abs(r.refund_credit) + r.hotel_travel_cost as total_breakdown_impact
from maintenance_records r
left join vehicles v on v.organization_id = r.organization_id and v.id = r.vehicle_id
left join maintenance_invoices i on i.organization_id = r.organization_id and i.id = r.invoice_id
where r.undone_at is null
union all
select
  e.organization_id,
  e.id as source_record_id,
  'expense'::text as source_type,
  e.vehicle_id,
  v.unit_number,
  e.maintenance_invoice_id as invoice_id,
  e.id as expense_id,
  e.invoice_hash,
  e.date as cost_date,
  null::text as shop,
  e.category as service_type,
  maintenance_service_key(e.category) as service_key,
  case when e.category = 'maintenance' then 'preventive_maintenance' else 'other' end as category,
  e.category = 'maintenance' as planned,
  'completed'::text as status,
  null::numeric as mileage_at_service,
  0::numeric as parts_cost,
  0::numeric as labor_cost,
  0::numeric as shop_fees,
  0::numeric as tax_cost,
  0::numeric as towing_cost,
  0::numeric as road_service_cost,
  0::numeric as hotel_travel_cost,
  e.amount as other_cost,
  0::numeric as warranty_recovery,
  e.amount as total_cost,
  e.amount as cpm_cost,
  null::timestamptz as downtime_start,
  null::timestamptz as downtime_end,
  0::numeric as downtime_days,
  null::text as cause,
  false::boolean as breakdown_occurred,
  0::numeric as diagnostic_cost,
  0::numeric as freight_shipping_cost,
  0::numeric as core_charge_cost,
  0::numeric as environmental_fee_cost,
  0::numeric as machine_shop_cost,
  0::numeric as sublet_cost,
  0::numeric as refund_credit,
  e.amount as total_breakdown_impact
from expenses e
left join vehicles v on v.organization_id = e.organization_id and v.id = e.vehicle_id
where e.category in ('maintenance','repair')
  and e.maintenance_invoice_id is null
  and e.invoice_hash is null;

revoke all on maintenance_cost_fact_v from public, anon;
grant select on maintenance_cost_fact_v to authenticated;

create or replace function seed_pm_inspection_checklists_20260714(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template uuid;
  v_basic_template uuid;
  v_item record;
begin
  if p_organization_id is null then raise exception 'organization_id is required.'; end if;

  insert into inspection_templates (organization_id, name, inspection_type, description, version, active)
  values (p_organization_id, 'PM Inspection - Temel', 'pm_a', 'Fleet-manager PM checklist. Tire and brake thresholds are editable; MPG, CCA, regen and DPF values are recorded without universal thresholds.', 2, true)
  on conflict (organization_id, name, version) do update set
    inspection_type = excluded.inspection_type,
    description = excluded.description,
    active = true,
    updated_at = now()
  returning id into v_template;
  v_basic_template := v_template;

  for v_item in
    select * from (values
      (10,'Service Info','Inspection date','text',null,true,null,null,'',''),
      (20,'Service Info','Mileage','number','mi',true,null,null,'',''),
      (30,'Service Info','Engine hours','number','hours',false,null,null,'',''),
      (40,'Fluids','Engine oil level','pass_fail',null,true,null,null,'',''),
      (50,'Fluids','Coolant level and visible leaks','pass_fail',null,true,null,null,'',''),
      (60,'Emissions','DEF condition/crystallization','pass_fail',null,true,null,null,'',''),
      (70,'Leaks','Engine/fuel/coolant leaks','pass_fail',null,true,null,null,'',''),
      (80,'Air Intake','Air-filter restriction','number','in H2O',false,null,null,'','Record measured value if available.'),
      (90,'Engine','Belts, tensioner and idlers','pass_fail',null,true,null,null,'',''),
      (100,'Engine','Hoses and clamps','pass_fail',null,true,null,null,'',''),
      (110,'Electrical','Battery/cables','pass_fail',null,true,null,null,'',''),
      (120,'Electrical','Battery CCA','number','CCA',false,null,null,'','Record measured CCA; compare with battery spec.'),
      (130,'Coupling','Fifth-wheel condition and lubrication','pass_fail',null,true,null,null,'',''),
      (140,'Wheel End','Hub oil and wheel seals','pass_fail',null,true,null,null,'','Critical if hot/leaking wheel end is found.'),
      (150,'Air Brake','Brake air leaks','pass_fail',null,true,null,null,'','Critical if severe air leak is found.'),
      (160,'Air Brake','Brake stroke or remaining percentage','number','%',false,25,15,'by axle','Editable fleet threshold.'),
      (170,'Suspension/Steering','Suspension and steering','pass_fail',null,true,null,null,'',''),
      (180,'Driveline','Driveshaft/U-joints','pass_fail',null,true,null,null,'',''),
      (190,'Tires','Tire tread depth','number','32nds',false,6,4,'by position','Editable fleet threshold.'),
      (200,'Tires','Tire pressure','number','psi',false,null,null,'by position','Compare with tire/load spec.'),
      (210,'Lights','Lights','pass_fail',null,true,null,null,'',''),
      (220,'Diagnostics','Fault codes','text',null,false,null,null,'',''),
      (230,'Emissions','Regen frequency','number','miles between regens',false,null,null,'','Record only; no universal threshold.'),
      (240,'Emissions','DPF differential pressure','number','kPa',false,null,null,'','Record only; follow OEM spec.'),
      (250,'Consumption','Oil consumption','number','qt',false,null,null,'','Oil added since last inspection.'),
      (260,'Consumption','Coolant added since last inspection','number','gal',false,null,null,'',''),
      (270,'Metrics','Idle percentage','number','%',false,null,null,'','Record only; interpret by duty cycle.'),
      (280,'Metrics','MPG','number','mpg',false,null,null,'','Record only; interpret by duty cycle.'),
      (290,'Safety','Mirrors and windshield','pass_fail',null,true,null,null,'',''),
      (300,'Safety','Wipers and washers','pass_fail',null,true,null,null,'',''),
      (310,'Safety','Horn and backup alarm','pass_fail',null,true,null,null,'',''),
      (320,'Safety','Fire extinguisher and triangles','pass_fail',null,true,null,null,'',''),
      (330,'Safety','Seat belt','pass_fail',null,true,null,null,'',''),
      (340,'Notes','Recommended action','text',null,false,null,null,'','')
    ) as x(sort_order, section, label, input_type, unit_of_measure, required, warning_threshold, critical_threshold, axle_position, instructions)
  loop
    insert into inspection_template_items (
      organization_id, template_id, section, label, input_type, unit_of_measure,
      required, warning_threshold, critical_threshold, axle_position, instructions, sort_order, active
    ) values (
      p_organization_id, v_template, v_item.section, v_item.label, v_item.input_type,
      v_item.unit_of_measure, v_item.required, v_item.warning_threshold, v_item.critical_threshold,
      v_item.axle_position, v_item.instructions, v_item.sort_order, true
    )
    on conflict (organization_id, template_id, label, axle_position) do update set
      section = excluded.section,
      input_type = excluded.input_type,
      unit_of_measure = excluded.unit_of_measure,
      required = excluded.required,
      warning_threshold = excluded.warning_threshold,
      critical_threshold = excluded.critical_threshold,
      instructions = excluded.instructions,
      sort_order = excluded.sort_order,
      active = true,
      updated_at = now();
  end loop;

  insert into inspection_templates (organization_id, name, inspection_type, description, version, active)
  values (p_organization_id, 'PM Inspection - Detaylı', 'pm_b', 'Detailed PM checklist including all Temel PM checks plus deeper system checks.', 2, true)
  on conflict (organization_id, name, version) do update set
    inspection_type = excluded.inspection_type,
    description = excluded.description,
    active = true,
    updated_at = now()
  returning id into v_template;

  insert into inspection_template_items (
    organization_id, template_id, section, label, input_type, unit_of_measure,
    required, warning_threshold, critical_threshold, axle_position, instructions, sort_order, active
  )
  select
    organization_id, v_template, section, label, input_type, unit_of_measure,
    required, warning_threshold, critical_threshold, axle_position, instructions, sort_order, active
  from inspection_template_items
  where organization_id = p_organization_id and template_id = v_basic_template
  on conflict (organization_id, template_id, label, axle_position) do update set
    section = excluded.section,
    input_type = excluded.input_type,
    unit_of_measure = excluded.unit_of_measure,
    required = excluded.required,
    warning_threshold = excluded.warning_threshold,
    critical_threshold = excluded.critical_threshold,
    instructions = excluded.instructions,
    sort_order = excluded.sort_order,
    active = true,
    updated_at = now();

  for v_item in
    select * from (values
      (1010,'Reference','Temel PM checklist completed','checkbox',null,true,null,null,'','Attach or complete Temel PM items first.'),
      (1020,'Engine','Engine mounts visual condition','pass_fail',null,true,null,null,'',''),
      (1030,'Engine','Fan and fan clutch visual condition','pass_fail',null,true,null,null,'',''),
      (1040,'Cooling','Radiator and CAC condition','pass_fail',null,true,null,null,'',''),
      (1050,'Cooling','Coolant contamination','pass_fail',null,true,null,null,'','Critical if contamination is present.'),
      (1060,'Fuel','Fuel-water separator','pass_fail',null,true,null,null,'',''),
      (1070,'Fuel','Fuel filter condition or replacement','pass_fail',null,true,null,null,'',''),
      (1080,'Air Intake','CAC / charge-air boots','pass_fail',null,true,null,null,'',''),
      (1090,'Aftertreatment','Aftertreatment warning lights','pass_fail',null,true,null,null,'',''),
      (1100,'Aftertreatment','Active severe derate','pass_fail',null,true,null,null,'','Critical if active severe derate exists.'),
      (1110,'Air System','Air dryer condition','pass_fail',null,true,null,null,'',''),
      (1120,'Air System','Air-pressure loss','number','psi/min',false,2,3,'','Editable fleet threshold.'),
      (1130,'Brakes','Brake chambers and hoses','pass_fail',null,true,null,null,'',''),
      (1140,'Brakes','ABS warning light','pass_fail',null,true,null,null,'',''),
      (1150,'Wheel End','Lug nuts visual condition','pass_fail',null,true,null,null,'',''),
      (1160,'Wheel End','Wheel bearing noise/play','pass_fail',null,true,null,null,'',''),
      (1170,'Steering','Tie rods / drag link','pass_fail',null,true,null,null,'',''),
      (1180,'Steering','Kingpins','pass_fail',null,true,null,null,'',''),
      (1190,'Suspension','Shocks, air bags and springs','pass_fail',null,true,null,null,'',''),
      (1200,'Suspension','Torque rods','pass_fail',null,true,null,null,'',''),
      (1210,'Driveline','Carrier bearing','pass_fail',null,true,null,null,'',''),
      (1220,'Driveline','Transmission / differential leaks','pass_fail',null,true,null,null,'',''),
      (1230,'Cab','Doors, hood, bumper and body panels','pass_fail',null,true,null,null,'',''),
      (1240,'Cab','HVAC / A/C operation','pass_fail',null,false,null,null,'',''),
      (1250,'Compliance','DOT annual sticker and documents','pass_fail',null,true,null,null,'',''),
      (1260,'Final','Road test notes','text',null,false,null,null,'','')
    ) as x(sort_order, section, label, input_type, unit_of_measure, required, warning_threshold, critical_threshold, axle_position, instructions)
  loop
    insert into inspection_template_items (
      organization_id, template_id, section, label, input_type, unit_of_measure,
      required, warning_threshold, critical_threshold, axle_position, instructions, sort_order, active
    ) values (
      p_organization_id, v_template, v_item.section, v_item.label, v_item.input_type,
      v_item.unit_of_measure, v_item.required, v_item.warning_threshold, v_item.critical_threshold,
      v_item.axle_position, v_item.instructions, v_item.sort_order, true
    )
    on conflict (organization_id, template_id, label, axle_position) do update set
      section = excluded.section,
      input_type = excluded.input_type,
      unit_of_measure = excluded.unit_of_measure,
      required = excluded.required,
      warning_threshold = excluded.warning_threshold,
      critical_threshold = excluded.critical_threshold,
      instructions = excluded.instructions,
      sort_order = excluded.sort_order,
      active = true,
      updated_at = now();
  end loop;
end;
$$;

revoke execute on function seed_pm_inspection_checklists_20260714(uuid) from public, anon;
grant execute on function seed_pm_inspection_checklists_20260714(uuid) to authenticated, service_role;

select seed_pm_inspection_checklists_20260714(id) from organizations;

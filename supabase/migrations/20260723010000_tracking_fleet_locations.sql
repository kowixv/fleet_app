-- Add organization-scoped saved support locations for the Tracking map.

create table if not exists public.fleet_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  location_type text not null,
  address_line text,
  city text,
  state text,
  postal_code text,
  latitude double precision not null,
  longitude double precision not null,
  phone text,
  email text,
  website text,
  business_hours text,
  is_24_hour boolean not null default false,
  mobile_service boolean not null default false,
  heavy_duty_capable boolean not null default true,
  preferred_vendor boolean not null default false,
  services text[] not null default '{}'::text[],
  internal_rating numeric,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fleet_locations_type_check check (
    location_type in (
      'yard',
      'mechanic_shop',
      'mobile_mechanic',
      'tire_shop',
      'dealer',
      'towing',
      'truck_parking',
      'truck_wash',
      'parts_store',
      'fuel_stop',
      'warehouse',
      'other'
    )
  ),
  constraint fleet_locations_name_check check (btrim(name) <> ''),
  constraint fleet_locations_latitude_check check (latitude between -90 and 90),
  constraint fleet_locations_longitude_check check (longitude between -180 and 180),
  constraint fleet_locations_rating_check check (
    internal_rating is null or internal_rating between 1 and 5
  )
);

create index if not exists fleet_locations_org_idx
  on public.fleet_locations (organization_id);
create index if not exists fleet_locations_type_idx
  on public.fleet_locations (location_type);
create index if not exists fleet_locations_active_idx
  on public.fleet_locations (organization_id, location_type)
  where active = true;
create index if not exists fleet_locations_org_lat_lng_idx
  on public.fleet_locations (organization_id, latitude, longitude);

alter table public.fleet_locations
  drop constraint if exists fleet_locations_org_id_id_key;
alter table public.fleet_locations
  add constraint fleet_locations_org_id_id_key unique (organization_id, id);

create or replace function public.update_fleet_locations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists fleet_locations_updated_at on public.fleet_locations;
create trigger fleet_locations_updated_at
  before update on public.fleet_locations
  for each row execute function public.update_fleet_locations_updated_at();

alter table public.fleet_locations enable row level security;

drop policy if exists fleet_locations_select on public.fleet_locations;
drop policy if exists fleet_locations_insert on public.fleet_locations;
drop policy if exists fleet_locations_update on public.fleet_locations;
drop policy if exists fleet_locations_delete on public.fleet_locations;

create policy fleet_locations_select on public.fleet_locations
  for select to authenticated
  using (organization_id = (select public.current_org_id()));

create policy fleet_locations_insert on public.fleet_locations
  for insert to authenticated
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
  );

create policy fleet_locations_update on public.fleet_locations
  for update to authenticated
  using (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
  )
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
  );

create policy fleet_locations_delete on public.fleet_locations
  for delete to authenticated
  using (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
  );

grant select, insert, update, delete on public.fleet_locations to authenticated;

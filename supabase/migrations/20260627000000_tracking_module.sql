-- ============================================================================
-- Fleet Tracking Module — DB Migration
-- Adds GPS tracking tables, geocoding fields, and RLS policies.
-- ============================================================================

-- ---------- Tracking enums ----------
create type tracking_mode as enum (
  'moving',
  'slow_traffic',
  'parking_maneuver',
  'parked_rest',
  'no_active_load',
  'approaching_pickup',
  'approaching_delivery',
  'offline'
);

create type tracking_status as enum (
  'active',
  'completed',
  'cancelled'
);

create type risk_score as enum ('low', 'medium', 'high');

create type appointment_status as enum (
  'early',
  'on_time',
  'tight',
  'at_risk',
  'late',
  'unknown'
);

create type geofence_status as enum (
  'en_route_to_pickup',
  'near_pickup',
  'arrived_pickup',
  'departed_pickup',
  'en_route_to_delivery',
  'near_delivery',
  'arrived_delivery',
  'departed_delivery'
);

-- ---------- 1. Extend loads table ----------
alter table loads
  add column if not exists pickup_lat double precision,
  add column if not exists pickup_lng double precision,
  add column if not exists delivery_lat double precision,
  add column if not exists delivery_lng double precision,
  add column if not exists geocoded_at timestamptz;

-- ---------- 2. unit_locations — one row per unit (latest position only) ----------
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

-- ---------- 3. load_tracking — per-load tracking state ----------
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
  -- Last 3 distances to current target (miles) — for route deviation detection
  distance_history jsonb default '[]'::jsonb,
  -- Last 3 GPS points for rest detection: [{lat, lng, ts, speed}]
  consecutive_positions jsonb default '[]'::jsonb,
  parked_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, load_id)
);

create index if not exists load_tracking_org_idx on load_tracking (organization_id);
create index if not exists load_tracking_load_idx on load_tracking (load_id);
create index if not exists load_tracking_status_idx on load_tracking (tracking_status) where tracking_status = 'active';

-- Trigger to keep updated_at current
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

-- ---------- 4. tracking_events — alerts and geofence events ----------
create table if not exists tracking_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  unit_id uuid references vehicles (id) on delete set null,
  load_id uuid references loads (id) on delete set null,
  event_type text not null check (event_type in (
    'NEAR_PICKUP',
    'ARRIVED_PICKUP',
    'DEPARTED_PICKUP',
    'REST_STARTED',
    'REST_EXTENDED',
    'MOVEMENT_RESUMED',
    'NEAR_DELIVERY',
    'ARRIVED_DELIVERY',
    'DEPARTED_DELIVERY',
    'NO_LOCATION_UPDATE',
    'TABLET_OFFLINE',
    'ROUTE_DEVIATION_WARNING'
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
-- Partial unique: one-time events that cannot repeat per load
create unique index if not exists tracking_events_once_per_load
  on tracking_events (load_id, event_type)
  where event_type in ('ARRIVED_PICKUP','DEPARTED_PICKUP','ARRIVED_DELIVERY','DEPARTED_DELIVERY');

-- ---------- 5. tablet_tokens — tablet device authentication ----------
create table if not exists tablet_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  unit_id uuid not null references vehicles (id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  device_id text,
  device_label text,                          -- human-readable label e.g. "Tablet Unit 14129"
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create index if not exists tablet_tokens_org_idx on tablet_tokens (organization_id);
create index if not exists tablet_tokens_token_idx on tablet_tokens (token) where is_active = true;
create index if not exists tablet_tokens_unit_idx on tablet_tokens (unit_id);

-- ---------- 6. RLS Policies ----------

-- unit_locations
alter table unit_locations enable row level security;
drop policy if exists unit_locations_rw on unit_locations;
create policy unit_locations_rw on unit_locations
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- load_tracking
alter table load_tracking enable row level security;
drop policy if exists load_tracking_rw on load_tracking;
create policy load_tracking_rw on load_tracking
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- tracking_events
alter table tracking_events enable row level security;
drop policy if exists tracking_events_rw on tracking_events;
create policy tracking_events_rw on tracking_events
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- tablet_tokens: authenticated users manage their org's tokens; service role handles tablet auth
alter table tablet_tokens enable row level security;
drop policy if exists tablet_tokens_rw on tablet_tokens;
create policy tablet_tokens_rw on tablet_tokens
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- ---------- 7. Composite org/id unique keys (matches existing pattern) ----------
alter table unit_locations drop constraint if exists unit_locations_org_id_id_key;
alter table unit_locations add constraint unit_locations_org_id_id_key unique (organization_id, id);

alter table load_tracking drop constraint if exists load_tracking_org_id_id_key;
alter table load_tracking add constraint load_tracking_org_id_id_key unique (organization_id, id);

alter table tracking_events drop constraint if exists tracking_events_org_id_id_key;
alter table tracking_events add constraint tracking_events_org_id_id_key unique (organization_id, id);

alter table tablet_tokens drop constraint if exists tablet_tokens_org_id_id_key;
alter table tablet_tokens add constraint tablet_tokens_org_id_id_key unique (organization_id, id);

-- Allow dispatch/operations to mark units parked at the yard or on driver hometime.

alter table public.vehicles
  drop constraint if exists vehicles_status_check;

alter table public.vehicles
  add constraint vehicles_status_check
  check (status in ('active', 'in_repair', 'yard_hometime', 'inactive'));

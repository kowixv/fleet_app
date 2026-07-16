-- Focused vehicle edit fields.
-- Truck color belongs to the vehicle identity record; engine data remains in
-- vehicle_maintenance_profiles.engine_model / engine_hours.

alter table vehicles
  add column if not exists truck_color text;

/**
 * Called when a load is approved (both Telegram webhook and web confirm).
 * Geocodes pickup/delivery addresses and creates a load_tracking record.
 * Fire-and-forget safe — errors are logged but do not break the load import flow.
 */

import { geocodeAddress } from './geocode';

export async function geocodeAndActivateTracking(
  supabase: ReturnType<typeof import('@/lib/supabase/server').createServiceClient>,
  loadId: string,
  orgId: string,
): Promise<void> {
  try {
    // Fetch the load
    const { data: load } = await supabase
      .from('loads')
      .select('id, pickup_location, delivery_location, vehicle_id, geocoded_at')
      .eq('id', loadId)
      .maybeSingle();

    if (!load) return;
    // Already geocoded — skip
    if (load.geocoded_at) {
      await ensureLoadTrackingExists(supabase, loadId, orgId);
      return;
    }

    // Geocode both addresses in parallel
    const [pickupCoords, deliveryCoords] = await Promise.all([
      load.pickup_location ? geocodeAddress(load.pickup_location) : null,
      load.delivery_location ? geocodeAddress(load.delivery_location) : null,
    ]);

    // Update loads table with coordinates
    await supabase
      .from('loads')
      .update({
        pickup_lat: pickupCoords?.lat ?? null,
        pickup_lng: pickupCoords?.lng ?? null,
        delivery_lat: deliveryCoords?.lat ?? null,
        delivery_lng: deliveryCoords?.lng ?? null,
        geocoded_at: new Date().toISOString(),
      })
      .eq('id', loadId);

    await ensureLoadTrackingExists(supabase, loadId, orgId);
  } catch (err) {
    // Do not break the load import flow
    console.error('geocodeAndActivateTracking error', err);
  }
}

async function ensureLoadTrackingExists(
  supabase: ReturnType<typeof import('@/lib/supabase/server').createServiceClient>,
  loadId: string,
  orgId: string,
): Promise<void> {
  // Upsert — idempotent if called twice
  await supabase
    .from('load_tracking')
    .upsert(
      {
        organization_id: orgId,
        load_id: loadId,
        tracking_status: 'active',
        geofence_status: 'en_route_to_pickup',
      },
      { onConflict: 'organization_id,load_id', ignoreDuplicates: true },
    );
}

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

    // Geocode sequentially — Nominatim's usage policy is 1 request/second and
    // a parallel pair can get rate-limited into null results.
    const pickupCoords = load.pickup_location ? await geocodeAddress(load.pickup_location) : null;
    const deliveryCoords = load.delivery_location ? await geocodeAddress(load.delivery_location) : null;

    // Stamp geocoded_at only when every provided address resolved. A failed
    // attempt leaves it null so the next create/update of the load retries —
    // otherwise one transient Nominatim error would disable geofencing for
    // this load forever.
    const fullyGeocoded =
      (!load.pickup_location || pickupCoords !== null) &&
      (!load.delivery_location || deliveryCoords !== null);

    await supabase
      .from('loads')
      .update({
        pickup_lat: pickupCoords?.lat ?? null,
        pickup_lng: pickupCoords?.lng ?? null,
        delivery_lat: deliveryCoords?.lat ?? null,
        delivery_lng: deliveryCoords?.lng ?? null,
        geocoded_at: fullyGeocoded ? new Date().toISOString() : null,
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

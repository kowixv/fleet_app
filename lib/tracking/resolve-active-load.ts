/**
 * Resolves "the load this unit is currently on".
 *
 * Booked loads always win. Only when the unit has no booked load do we fall
 * back to a recently delivered one (so post-delivery geofence events keep
 * flowing for a while) — previously `in ('booked','delivered') order by
 * pickup_date desc` let an old delivered load with a newer pickup_date shadow
 * the actual booked load, and a delivered load stayed "active" forever.
 */

import { todayISO } from '@/lib/tz';

/** How long a delivered load still counts as the unit's active load. */
const DELIVERED_GRACE_HOURS = 48;

export async function resolveActiveLoad(
  supabase: ReturnType<typeof import('@/lib/supabase/server').createServiceClient>,
  orgId: string,
  unitId: string,
  select: string,
): Promise<{ load: any | null; error: { message: string } | null }> {
  const base = () =>
    supabase
      .from('loads')
      .select(select)
      .eq('organization_id', orgId)
      .eq('vehicle_id', unitId);

  const { data: booked, error: bookedErr } = await base()
    .eq('status', 'booked')
    .order('pickup_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (bookedErr) return { load: null, error: bookedErr };
  if (booked) return { load: booked, error: null };

  const cutoff = todayISO(new Date(Date.now() - DELIVERED_GRACE_HOURS * 3_600_000));
  const { data: delivered, error: deliveredErr } = await base()
    .eq('status', 'delivered')
    .gte('delivery_date', cutoff)
    .order('delivery_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { load: delivered ?? null, error: deliveredErr };
}

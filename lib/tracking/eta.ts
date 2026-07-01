/**
 * ETA Calculator — on-demand only via Google Routes API.
 * Called only when the admin requests it; results are cached for 15 minutes.
 */

import type { ETAResult } from './types';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function calculateETA(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  cachedAt: string | null,
  cachedMinutes: number | null,
): Promise<ETAResult | null> {
  // Return cached result if still valid
  if (cachedAt && cachedMinutes !== null) {
    const age = Date.now() - new Date(cachedAt).getTime();
    if (age < CACHE_TTL_MS) {
      return { minutes: cachedMinutes, calculated_at: cachedAt };
    }
  }

  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) {
    console.warn('tracking/eta: GOOGLE_ROUTES_API_KEY not set');
    return null;
  }

  try {
    const res = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.duration',
        },
        body: JSON.stringify({
          origin: {
            location: { latLng: { latitude: originLat, longitude: originLng } },
          },
          destination: {
            location: { latLng: { latitude: destLat, longitude: destLng } },
          },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
        }),
      },
    );

    if (!res.ok) {
      console.error('tracking/eta: Routes API error', res.status, await res.text());
      return null;
    }

    const json = await res.json() as {
      routes?: Array<{ duration: string }>;
    };

    const durationStr = json.routes?.[0]?.duration; // e.g. "3600s"
    if (!durationStr) return null;

    const seconds = parseInt(durationStr.replace('s', ''), 10);
    const minutes = Math.round(seconds / 60);
    const calculated_at = new Date().toISOString();

    return { minutes, calculated_at };
  } catch (err) {
    console.error('tracking/eta: fetch error', err);
    return null;
  }
}

/** Format ETA minutes into a human-readable string */
export function formatETA(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

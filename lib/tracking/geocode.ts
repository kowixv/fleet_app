/**
 * Geocodes a street address to lat/lng using Nominatim (OpenStreetMap).
 * Free, no API key required. Rate limit: 1 request/second.
 *
 * Called exactly once per load when it is approved — never from the tablet.
 * The 1 req/sec limit is fine since load approvals are not concurrent.
 */

export interface GeocodedPoint {
  lat: number;
  lng: number;
}

export async function geocodeAddress(address: string): Promise<GeocodedPoint | null> {
  if (!address || address.trim().length < 3) return null;

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', address.trim());
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '0');

    const res = await fetch(url.toString(), {
      headers: {
        // Nominatim usage policy requires a User-Agent identifying the app
        'User-Agent': 'FleetOperationsApp/1.0 (contact@fleet.app)',
        'Accept-Language': 'en',
      },
    });

    if (!res.ok) {
      console.error('tracking/geocode: Nominatim HTTP error', res.status);
      return null;
    }

    const results = await res.json() as Array<{ lat: string; lon: string }>;

    if (!results.length) {
      console.warn('tracking/geocode: no results for', address);
      return null;
    }

    return {
      lat: parseFloat(results[0].lat),
      lng: parseFloat(results[0].lon),
    };
  } catch (err) {
    console.error('tracking/geocode: fetch error', err);
    return null;
  }
}

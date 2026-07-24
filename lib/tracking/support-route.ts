export interface SupportRouteResult {
  driving_distance_miles: number;
  driving_eta_minutes: number;
  calculated_at: string;
}

export async function calculateSupportRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<SupportRouteResult | null> {
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
        destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      }),
    });

    if (!res.ok) {
      console.error("tracking/support-route: Routes API error", res.status, await res.text());
      return null;
    }

    const json = await res.json() as {
      routes?: Array<{ duration?: string; distanceMeters?: number }>;
    };
    const route = json.routes?.[0];
    if (!route?.duration || typeof route.distanceMeters !== "number") return null;

    const seconds = Number.parseInt(route.duration.replace("s", ""), 10);
    if (!Number.isFinite(seconds)) return null;

    return {
      driving_distance_miles: Math.round((route.distanceMeters / 1609.344) * 10) / 10,
      driving_eta_minutes: Math.round(seconds / 60),
      calculated_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error("tracking/support-route: fetch error", err);
    return null;
  }
}

"use client";

import { useMemo, useState } from "react";
import type { MapFleetLocation, MapUnit } from "@/components/tracking/TrackingMap";
import type { FleetLocationType, NearbyLocation } from "@/lib/tracking/location-types";
import {
  DEFAULT_SUPPORT_TYPES,
  FLEET_LOCATION_LABELS,
  buildDirectionsUrl,
  buildDriverMessage,
  formatFleetLocationAddress,
  getNearbyFleetLocations,
} from "@/lib/tracking/location-types";

const RADIUS_OPTIONS: Array<number | "all"> = [25, 50, 100, 250, "all"];

export default function NearbySupportPanel({
  unit,
  locations,
  onSelectLocation,
}: {
  unit: MapUnit | null;
  locations: MapFleetLocation[];
  onSelectLocation: (id: string) => void;
}) {
  const [types, setTypes] = useState<FleetLocationType[]>(DEFAULT_SUPPORT_TYPES);
  const [radius, setRadius] = useState<number | "all">(50);
  const [preferredOnly, setPreferredOnly] = useState(false);
  const [open24Only, setOpen24Only] = useState(false);
  const [mobileOnly, setMobileOnly] = useState(false);
  const [routeState, setRouteState] = useState<Record<string, string>>({});

  const nearby = useMemo(
    () => getNearbyFleetLocations(unit, locations, {
      types,
      radiusMiles: radius,
      preferredOnly,
      open24Only,
      mobileOnly,
      limit: 20,
    }),
    [locations, mobileOnly, open24Only, preferredOnly, radius, types, unit],
  );

  if (!unit) return null;
  const currentUnit = unit;

  function toggleType(type: FleetLocationType) {
    setTypes((prev) => prev.includes(type) ? prev.filter((item) => item !== type) : [...prev, type]);
  }

  async function copyDriverMessage(location: NearbyLocation) {
    const directionsUrl = buildDirectionsUrl({
      destinationLat: location.latitude,
      destinationLng: location.longitude,
      originLat: currentUnit.latitude,
      originLng: currentUnit.longitude,
    });
    await navigator.clipboard.writeText(buildDriverMessage({
      unitNumber: currentUnit.unit_number,
      location,
      approxDistanceMiles: location.approx_distance_miles,
      directionsUrl,
    }));
  }

  async function loadDrivingEta(location: NearbyLocation) {
    setRouteState((prev) => ({ ...prev, [location.id]: "Loading..." }));
    try {
      const res = await fetch("/api/tracking/support-eta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unit_id: currentUnit.unit_id, location_id: location.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRouteState((prev) => ({ ...prev, [location.id]: data.error ?? "Driving ETA unavailable." }));
        return;
      }
      setRouteState((prev) => ({
        ...prev,
        [location.id]: `${data.driving_distance_miles} mi driving, ${data.driving_eta_minutes} min`,
      }));
    } catch {
      setRouteState((prev) => ({ ...prev, [location.id]: "Driving ETA unavailable." }));
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Nearby Support</h2>
          <p className="text-sm text-gray-500">
            Unit {unit.unit_number} - {unit.latitude.toFixed(5)}, {unit.longitude.toFixed(5)} - {unit.tracking_mode.replace(/_/g, " ")}
          </p>
          <p className="text-xs text-gray-400">Last update {new Date(unit.last_update_at).toLocaleString()}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {RADIUS_OPTIONS.map((option) => (
            <button
              key={String(option)}
              type="button"
              onClick={() => setRadius(option)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                radius === option ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {option === "all" ? "All" : `${option} mi`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {DEFAULT_SUPPORT_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => toggleType(type)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              types.includes(type) ? "bg-slate-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {FLEET_LOCATION_LABELS[type]}
          </button>
        ))}
        <label className="flex items-center gap-1.5 rounded-full bg-gray-50 px-3 py-1 text-xs text-gray-600">
          <input type="checkbox" checked={preferredOnly} onChange={(e) => setPreferredOnly(e.target.checked)} />
          Preferred only
        </label>
        <label className="flex items-center gap-1.5 rounded-full bg-gray-50 px-3 py-1 text-xs text-gray-600">
          <input type="checkbox" checked={open24Only} onChange={(e) => setOpen24Only(e.target.checked)} />
          24/7 only
        </label>
        <label className="flex items-center gap-1.5 rounded-full bg-gray-50 px-3 py-1 text-xs text-gray-600">
          <input type="checkbox" checked={mobileOnly} onChange={(e) => setMobileOnly(e.target.checked)} />
          Mobile service only
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {nearby.length === 0 && (
          <div className="rounded border border-dashed border-gray-200 p-4 text-sm text-gray-400">
            No saved support locations match this unit and filter.
          </div>
        )}
        {nearby.map((location) => {
          const directionsUrl = buildDirectionsUrl({
            destinationLat: location.latitude,
            destinationLng: location.longitude,
            originLat: currentUnit.latitude,
            originLng: currentUnit.longitude,
          });
          const telHref = location.phone ? `tel:${location.phone.replace(/[^\d+]/g, "")}` : null;
          const maintenanceHref = `/maintenance?vehicle=${encodeURIComponent(currentUnit.unit_id)}&shop=${encodeURIComponent(location.name)}&location=${encodeURIComponent(location.id)}&note=${encodeURIComponent("Created from Tracking map support-location recommendation.")}`;
          return (
            <article key={location.id} className="rounded-lg border border-gray-200 p-3">
              <button
                type="button"
                onClick={() => onSelectLocation(location.id)}
                className="text-left font-semibold text-gray-900 hover:text-blue-700"
              >
                {location.name}
              </button>
              <div className="mt-0.5 text-xs text-gray-500">
                {FLEET_LOCATION_LABELS[location.location_type]} - Approx. {location.approx_distance_miles.toFixed(1)} mi
              </div>
              <div className="mt-2 whitespace-pre-line text-xs text-gray-600">
                {formatFleetLocationAddress(location) || `${location.latitude}, ${location.longitude}`}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {location.preferred_vendor && <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs text-yellow-800">Preferred Vendor</span>}
                {location.is_24_hour && <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">Open 24/7</span>}
                {location.mobile_service && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">Mobile Service</span>}
              </div>
              {routeState[location.id] && (
                <div className="mt-2 text-xs text-gray-600">{routeState[location.id]}</div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {telHref && <a className="rounded border border-gray-200 px-2 py-1 text-xs" href={telHref}>Call</a>}
                <a className="rounded border border-gray-200 px-2 py-1 text-xs" href={directionsUrl} target="_blank" rel="noreferrer">Directions</a>
                <button className="rounded border border-gray-200 px-2 py-1 text-xs" type="button" onClick={() => loadDrivingEta(location)}>Driving ETA</button>
                <button className="rounded border border-gray-200 px-2 py-1 text-xs" type="button" onClick={() => copyDriverMessage(location)}>Copy Driver Message</button>
                <a className="rounded border border-gray-200 px-2 py-1 text-xs" href={maintenanceHref}>Create Maintenance Case</a>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

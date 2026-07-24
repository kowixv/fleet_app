"use client";

import { Fragment, useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap, useMapEvents } from "react-leaflet";
import type { Map as LeafletMapType } from "leaflet";
import type { MapFleetLocation, MapUnit } from "./TrackingMap";
import type { TrackingMode } from "@/lib/tracking/types";
import type { FleetLocationType } from "@/lib/tracking/location-types";
import {
  FLEET_LOCATION_LABELS,
  buildDirectionsUrl,
  formatFleetLocationAddress,
  getLocationMarkerStyle,
} from "@/lib/tracking/location-types";
import { MAX_RELIABLE_ACCURACY_M } from "@/lib/tracking/position-filter";
import "leaflet/dist/leaflet.css";

/** Below this, the accuracy circle is visually negligible — skip drawing it. */
const MIN_ACCURACY_TO_DRAW_M = 30;

// Markers use custom divIcons (createTruckIcon) — no default marker images,
// so the usual Leaflet/webpack icon-path patch isn't needed.
import L from "leaflet";

const MODE_ICON_COLOR: Record<TrackingMode, string> = {
  moving: "🟢",
  slow_traffic: "🟡",
  parking_maneuver: "🟠",
  parked_rest: "🔴",
  no_active_load: "⚪",
  approaching_pickup: "🔵",
  approaching_delivery: "🟣",
  offline: "⚫",
};

const LOCATION_ICON_SVGS: Record<FleetLocationType, string> = {
  yard: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 4l9 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/></svg>',
  mechanic_shop: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-3 3-3-3 3-3z"/></svg>',
  mobile_mechanic: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h11v8H3z"/><path d="M14 11h4l3 3v2h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/><path d="m7 6 3-3 2 2-3 3"/></svg>',
  tire_shop: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v5M12 15v5M4 12h5M15 12h5"/></svg>',
  dealer: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V6h12v14"/><path d="M16 10h4v10"/><path d="M8 10h1M12 10h1M8 14h1M12 14h1"/></svg>',
  towing: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17h9V8H4z"/><path d="M13 11h4l3 3v3h-7z"/><circle cx="7" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/><path d="M8 8V5h7"/><path d="M15 5v3"/></svg>',
  truck_parking: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 20V4h6a4 4 0 0 1 0 8H8"/><path d="M8 12h6"/></svg>',
  truck_wash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16h14"/><path d="M7 16l2-6h6l2 6"/><circle cx="8" cy="18" r="1.4"/><circle cx="16" cy="18" r="1.4"/><path d="M8 4c-1 1-1 2 0 3M12 3c-1 1.2-1 2.4 0 3.5M16 4c-1 1-1 2 0 3"/></svg>',
  parts_store: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
  fuel_stop: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20V5h8v15"/><path d="M6 9h8"/><path d="M14 7h2l2 2v8a2 2 0 0 0 4 0v-5l-2-2"/></svg>',
  warehouse: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20V9l9-5 9 5v11"/><path d="M7 20v-7h10v7"/><path d="M7 16h10"/></svg>',
  other: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.2 7-11a7 7 0 0 0-14 0c0 5.8 7 11 7 11z"/><circle cx="12" cy="10" r="2"/></svg>',
};

function createTruckIcon(mode: TrackingMode, selected: boolean) {
  const emoji = MODE_ICON_COLOR[mode];
  const size = selected ? 40 : 32;
  const html = `<div style="
    font-size: ${size}px;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
    cursor: pointer;
    transform: translate(-50%, -50%);
    line-height: 1;
  ">${emoji}🚛</div>`;
  return L.divIcon({
    html,
    className: "",
    iconSize: [size * 2, size],
    iconAnchor: [size, size / 2],
  });
}

function createLocationIcon(location: MapFleetLocation, selected: boolean) {
  const style = getLocationMarkerStyle(location.location_type);
  const iconSvg = LOCATION_ICON_SVGS[location.location_type] ?? LOCATION_ICON_SVGS.other;
  const size = selected ? 34 : 28;
  const star = location.preferred_vendor
    ? `<span style="position:absolute;right:-7px;top:-8px;background:#facc15;color:#713f12;border:1px solid #a16207;border-radius:999px;width:16px;height:16px;font-size:11px;line-height:14px;text-align:center;">*</span>`
    : "";
  const html = `<div title="${style.label}" style="
    position:relative;
    width:${size}px;
    height:${size}px;
    border-radius:999px 999px 999px 4px;
    background:${style.bg};
    color:${style.fg};
    border:${selected ? "3px solid #facc15" : "2px solid #ffffff"};
    box-shadow:0 2px 6px rgba(0,0,0,0.28);
    transform:rotate(-45deg);
    display:flex;
    align-items:center;
    justify-content:center;
    font-weight:800;
    cursor:pointer;
  "><span style="transform:rotate(45deg);line-height:1;display:flex;align-items:center;justify-content:center;">${iconSvg}</span>${star}</div>`;
  return L.divIcon({
    html,
    className: "",
    iconSize: [size + 14, size + 14],
    iconAnchor: [(size + 14) / 2, size + 10],
  });
}

function createPreviewIcon() {
  const html = `<div style="
    width:30px;
    height:30px;
    border-radius:999px 999px 999px 4px;
    background:#ffffff;
    border:3px solid #2563eb;
    box-shadow:0 2px 8px rgba(37,99,235,0.35);
    transform:rotate(-45deg);
  "></div>`;
  return L.divIcon({ html, className: "", iconSize: [36, 36], iconAnchor: [18, 32] });
}

function FlyToSelected({ units, selectedUnitId }: { units: MapUnit[]; selectedUnitId: string | null }) {
  const map = useMap();
  useEffect(() => {
    if (!selectedUnitId) return;
    const unit = units.find((u) => u.unit_id === selectedUnitId);
    if (unit) {
      map.flyTo([unit.latitude, unit.longitude], 12, { duration: 0.8 });
    }
  }, [selectedUnitId, units, map]);
  return null;
}

function FlyToSelectedLocation({
  locations,
  selectedLocationId,
}: {
  locations: MapFleetLocation[];
  selectedLocationId: string | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!selectedLocationId) return;
    const location = locations.find((item) => item.id === selectedLocationId);
    if (location) {
      map.flyTo([location.latitude, location.longitude], Math.max(map.getZoom(), 11), { duration: 0.6 });
    }
  }, [locations, map, selectedLocationId]);
  return null;
}

function MapClickHandler({
  onMapClick,
}: {
  onMapClick?: (point: { latitude: number; longitude: number }) => void;
}) {
  useMapEvents({
    click(event) {
      onMapClick?.({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });
  return null;
}

function safeTelHref(phone: string | null) {
  if (!phone) return null;
  const safe = phone.replace(/[^\d+]/g, "");
  return safe ? `tel:${safe}` : null;
}

function LocationPopup({
  location,
  selectedUnit,
}: {
  location: MapFleetLocation;
  selectedUnit: MapUnit | null;
}) {
  const address = formatFleetLocationAddress(location);
  const directionsUrl = buildDirectionsUrl({
    destinationLat: location.latitude,
    destinationLng: location.longitude,
    originLat: selectedUnit?.latitude,
    originLng: selectedUnit?.longitude,
  });
  const telHref = safeTelHref(location.phone);

  async function copyAddress() {
    await navigator.clipboard.writeText(address || `${location.latitude}, ${location.longitude}`);
  }

  return (
    <div className="w-64 space-y-2 text-sm">
      <div>
        <div className="font-semibold text-gray-900">{location.name}</div>
        <div className="text-xs text-gray-500">
          {FLEET_LOCATION_LABELS[location.location_type]}
          {[location.city, location.state].filter(Boolean).length > 0 && (
            <> - {[location.city, location.state].filter(Boolean).join(", ")}</>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {location.preferred_vendor && <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs text-yellow-800">Preferred</span>}
        {location.is_24_hour && <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">Open 24/7</span>}
        {location.mobile_service && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">Mobile</span>}
        {location.heavy_duty_capable && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">Heavy Duty</span>}
      </div>
      {location.phone && (
        <div>
          {telHref ? <a className="text-blue-600 underline" href={telHref}>{location.phone}</a> : location.phone}
        </div>
      )}
      {location.business_hours && <div className="text-xs text-gray-600">{location.business_hours}</div>}
      {location.services.length > 0 && (
        <div className="text-xs text-gray-600">{location.services.slice(0, 5).join(", ")}</div>
      )}
      {location.internal_rating !== null && (
        <div className="text-xs text-gray-600">Rating: {Number(location.internal_rating).toFixed(1)} / 5</div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {telHref && (
          <a className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50" href={telHref}>
            Call
          </a>
        )}
        <a
          className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          href={directionsUrl}
          target="_blank"
          rel="noreferrer"
        >
          Directions
        </a>
        <button
          className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          type="button"
          onClick={copyAddress}
        >
          Copy Address
        </button>
      </div>
    </div>
  );
}

export default function LeafletMapInner({
  units,
  locations,
  showLocations,
  visibleLocationTypes,
  selectedLocationId,
  selectedUnitId,
  onSelectUnit,
  onSelectLocation,
  onMapClick,
  placementPreview,
}: {
  units: MapUnit[];
  locations: MapFleetLocation[];
  showLocations: boolean;
  visibleLocationTypes: FleetLocationType[];
  selectedLocationId: string | null;
  selectedUnitId: string | null;
  onSelectUnit: (id: string) => void;
  onSelectLocation?: (id: string) => void;
  onMapClick?: (point: { latitude: number; longitude: number }) => void;
  placementPreview: { latitude: number; longitude: number } | null;
}) {
  const mapRef = useRef<LeafletMapType | null>(null);
  const selectedUnit = useMemo(
    () => units.find((unit) => unit.unit_id === selectedUnitId) ?? null,
    [selectedUnitId, units],
  );
  const visibleTypeSet = useMemo(() => new Set(visibleLocationTypes), [visibleLocationTypes]);
  const visibleLocations = showLocations
    ? locations.filter((location) => visibleTypeSet.size === 0 || visibleTypeSet.has(location.location_type))
    : [];

  // Default center: US
  const center: [number, number] = units.length > 0
    ? [units[0].latitude, units[0].longitude]
    : [39.5, -98.35];

  return (
    <MapContainer
      center={center}
      zoom={units.length > 0 ? 8 : 4}
      style={{ height: "100%", width: "100%" }}
      ref={mapRef as any}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
      />
      <MapClickHandler onMapClick={onMapClick} />
      <FlyToSelected units={units} selectedUnitId={selectedUnitId} />
      <FlyToSelectedLocation locations={locations} selectedLocationId={selectedLocationId} />
      {visibleLocations.map((location) => (
        <Marker
          key={location.id}
          position={[location.latitude, location.longitude]}
          icon={createLocationIcon(location, location.id === selectedLocationId)}
          eventHandlers={{ click: () => onSelectLocation?.(location.id) }}
        >
          <Popup>
            <LocationPopup location={location} selectedUnit={selectedUnit} />
          </Popup>
        </Marker>
      ))}
      {placementPreview && (
        <Marker
          position={[placementPreview.latitude, placementPreview.longitude]}
          icon={createPreviewIcon()}
        />
      )}
      {units.map((unit) => {
        const accuracy = unit.accuracy ?? null;
        const accuracyPoor = accuracy !== null && accuracy > MAX_RELIABLE_ACCURACY_M;
        return (
          <Fragment key={unit.unit_id}>
            {accuracy !== null && accuracy > MIN_ACCURACY_TO_DRAW_M && (
              <Circle
                center={[unit.latitude, unit.longitude]}
                radius={accuracy}
                pathOptions={{
                  color: accuracyPoor ? "#f59e0b" : "#3b82f6",
                  fillColor: accuracyPoor ? "#f59e0b" : "#3b82f6",
                  fillOpacity: 0.12,
                  weight: 1,
                }}
              />
            )}
            <Marker
              position={[unit.latitude, unit.longitude]}
              icon={createTruckIcon(unit.tracking_mode, unit.unit_id === selectedUnitId)}
              eventHandlers={{ click: () => onSelectUnit(unit.unit_id) }}
            >
              <Popup>
                <div className="text-sm">
                  <div className="font-semibold">Unit {unit.unit_number}</div>
                  {unit.load_number && <div>Load #{unit.load_number}</div>}
                  <div className="capitalize text-gray-500">{unit.tracking_mode.replace("_", " ")}</div>
                  {accuracy !== null && (
                    <div className={accuracyPoor ? "mt-1 text-amber-600" : "mt-1 text-gray-400"}>
                      ~{Math.round(accuracy)} m hassasiyet
                      {accuracyPoor && " — konum kesin olmayabilir"}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          </Fragment>
        );
      })}
    </MapContainer>
  );
}

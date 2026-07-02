"use client";

import { Fragment, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import type { Map as LeafletMapType } from "leaflet";
import type { MapUnit } from "./TrackingMap";
import type { TrackingMode } from "@/lib/tracking/types";
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

export default function LeafletMapInner({
  units,
  selectedUnitId,
  onSelectUnit,
}: {
  units: MapUnit[];
  selectedUnitId: string | null;
  onSelectUnit: (id: string) => void;
}) {
  const mapRef = useRef<LeafletMapType | null>(null);

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
      <FlyToSelected units={units} selectedUnitId={selectedUnitId} />
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

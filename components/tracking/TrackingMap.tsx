"use client";

import dynamic from "next/dynamic";
import type { TrackingMode } from "@/lib/tracking/types";
import type { FleetLocationType } from "@/lib/tracking/location-types";

// Leaflet can only load in the browser
const LeafletMap = dynamic(() => import("./LeafletMapInner"), { ssr: false });

export interface MapUnit {
  unit_id: string;
  unit_number: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  tracking_mode: TrackingMode;
  last_update_at: string;
  load_number?: string | null;
}

export interface MapFleetLocation {
  id: string;
  name: string;
  location_type: FleetLocationType;
  latitude: number;
  longitude: number;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  business_hours: string | null;
  is_24_hour: boolean;
  mobile_service: boolean;
  heavy_duty_capable: boolean;
  preferred_vendor: boolean;
  services: string[];
  internal_rating: number | null;
}

export default function TrackingMap({
  units,
  locations,
  showLocations = true,
  visibleLocationTypes,
  selectedLocationId,
  selectedUnitId,
  onSelectUnit,
  onSelectLocation,
  onMapClick,
  placementPreview,
}: {
  units: MapUnit[];
  locations?: MapFleetLocation[];
  showLocations?: boolean;
  visibleLocationTypes?: FleetLocationType[];
  selectedLocationId?: string | null;
  selectedUnitId: string | null;
  onSelectUnit: (id: string) => void;
  onSelectLocation?: (id: string) => void;
  onMapClick?: (point: { latitude: number; longitude: number }) => void;
  placementPreview?: { latitude: number; longitude: number } | null;
}) {
  return (
    <div className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 480 }}>
      <LeafletMap
        units={units}
        locations={locations ?? []}
        showLocations={showLocations}
        visibleLocationTypes={visibleLocationTypes ?? []}
        selectedLocationId={selectedLocationId ?? null}
        selectedUnitId={selectedUnitId}
        onSelectUnit={onSelectUnit}
        onSelectLocation={onSelectLocation}
        onMapClick={onMapClick}
        placementPreview={placementPreview ?? null}
      />
    </div>
  );
}

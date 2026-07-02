"use client";

import dynamic from "next/dynamic";
import type { TrackingMode } from "@/lib/tracking/types";

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

export default function TrackingMap({
  units,
  selectedUnitId,
  onSelectUnit,
}: {
  units: MapUnit[];
  selectedUnitId: string | null;
  onSelectUnit: (id: string) => void;
}) {
  return (
    <div className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 480 }}>
      <LeafletMap
        units={units}
        selectedUnitId={selectedUnitId}
        onSelectUnit={onSelectUnit}
      />
    </div>
  );
}

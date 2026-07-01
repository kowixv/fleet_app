"use client";

import { RiskBadge, AppointmentBadge, ModeBadge, ETADisplay, TimeAgo } from "./Badges";
import type { TrackingMode, RiskScore, AppointmentStatus, GeofenceStatus } from "@/lib/tracking/types";

export interface TrackingRow {
  load_id: string;
  load_number: string | null;
  unit_number: string;
  driver_name: string | null;
  tracking_mode: TrackingMode;
  geofence_status: GeofenceStatus;
  last_update_at: string | null;
  risk_score: RiskScore;
  risk_reasons: string[];
  appointment_status: AppointmentStatus;
  eta_minutes: number | null;
  eta_calculated_at: string | null;
  has_route_deviation: boolean;
}

const GEOFENCE_LABELS: Record<GeofenceStatus, string> = {
  en_route_to_pickup: "En Route → Pickup",
  near_pickup: "Near Pickup",
  arrived_pickup: "At Pickup",
  departed_pickup: "Left Pickup",
  en_route_to_delivery: "En Route → Delivery",
  near_delivery: "Near Delivery",
  arrived_delivery: "At Delivery",
  departed_delivery: "Delivered",
};

const FILTER_LABELS: Record<string, string> = {
  all: "All",
  high_risk: "High Risk",
  warning: "Warning",
  no_update: "No Update",
  near_pickup: "Near Pickup",
  near_delivery: "Near Delivery",
  deviation: "Route Deviation",
};

type FilterKey = keyof typeof FILTER_LABELS;

export default function TrackingTable({
  rows,
  activeFilter,
  onFilterChange,
  loadingETA,
  onRefreshETA,
  onSelectUnit,
}: {
  rows: TrackingRow[];
  activeFilter: FilterKey;
  onFilterChange: (f: FilterKey) => void;
  loadingETA: string | null;
  onRefreshETA: (loadId: string) => void;
  onSelectUnit: (unitId: string) => void;
}) {
  const filtered = rows.filter((r) => {
    switch (activeFilter) {
      case "high_risk": return r.risk_score === "high";
      case "warning": return r.risk_score === "high" || r.risk_score === "medium";
      case "no_update":
        return r.last_update_at
          ? Date.now() - new Date(r.last_update_at).getTime() > 90 * 60_000
          : true;
      case "near_pickup": return r.geofence_status === "near_pickup" || r.geofence_status === "arrived_pickup";
      case "near_delivery": return r.geofence_status === "near_delivery" || r.geofence_status === "arrived_delivery";
      case "deviation": return r.has_route_deviation;
      default: return true;
    }
  });

  return (
    <div className="space-y-3">
      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(FILTER_LABELS) as FilterKey[]).map((f) => (
          <button
            key={f}
            onClick={() => onFilterChange(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              activeFilter === f
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-left">Unit</th>
              <th className="px-4 py-3 text-left">Driver</th>
              <th className="px-4 py-3 text-left">Load</th>
              <th className="px-4 py-3 text-left">Mode</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Last Update</th>
              <th className="px-4 py-3 text-left">Risk</th>
              <th className="px-4 py-3 text-left">Appt</th>
              <th className="px-4 py-3 text-left">ETA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-sm">
                  No active loads matching filter.
                </td>
              </tr>
            )}
            {filtered.map((row) => (
              <tr
                key={row.load_id}
                className="hover:bg-gray-50 cursor-pointer"
                onClick={() => onSelectUnit(row.load_id)}
              >
                <td className="px-4 py-3 font-semibold text-gray-900">
                  Unit {row.unit_number}
                  {row.has_route_deviation && (
                    <span className="ml-1 text-orange-500" title="Route deviation">⚠</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">{row.driver_name ?? "—"}</td>
                <td className="px-4 py-3 text-gray-600">{row.load_number ?? "—"}</td>
                <td className="px-4 py-3">
                  <ModeBadge mode={row.tracking_mode} />
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {GEOFENCE_LABELS[row.geofence_status]}
                </td>
                <td className="px-4 py-3">
                  <TimeAgo ts={row.last_update_at} />
                </td>
                <td className="px-4 py-3">
                  <RiskBadge score={row.risk_score} reasons={row.risk_reasons} />
                </td>
                <td className="px-4 py-3">
                  <AppointmentBadge status={row.appointment_status} />
                </td>
                <td className="px-4 py-3">
                  <ETADisplay
                    loadId={row.load_id}
                    etaMinutes={row.eta_minutes}
                    calculatedAt={row.eta_calculated_at}
                    onRefresh={onRefreshETA}
                    loading={loadingETA === row.load_id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

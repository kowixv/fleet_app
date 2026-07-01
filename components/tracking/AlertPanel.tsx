"use client";

import { useState } from "react";
import type { TrackingMode } from "@/lib/tracking/types";

export interface AlertItem {
  id: string;
  event_type: string;
  unit_number: string | null;
  load_number: string | null;
  created_at: string;
  acknowledged: boolean;
  metadata: Record<string, unknown>;
}

const EVENT_ICONS: Record<string, string> = {
  NEAR_PICKUP: "📍",
  ARRIVED_PICKUP: "✅",
  DEPARTED_PICKUP: "🚀",
  REST_STARTED: "😴",
  REST_EXTENDED: "⏰",
  MOVEMENT_RESUMED: "🚛",
  NEAR_DELIVERY: "📦",
  ARRIVED_DELIVERY: "🏁",
  DEPARTED_DELIVERY: "✅",
  NO_LOCATION_UPDATE: "📵",
  TABLET_OFFLINE: "❌",
  ROUTE_DEVIATION_WARNING: "⚠️",
};

const EVENT_COLORS: Record<string, string> = {
  NEAR_PICKUP: "border-blue-200 bg-blue-50",
  ARRIVED_PICKUP: "border-green-200 bg-green-50",
  DEPARTED_PICKUP: "border-green-200 bg-green-50",
  REST_STARTED: "border-yellow-200 bg-yellow-50",
  REST_EXTENDED: "border-orange-200 bg-orange-50",
  MOVEMENT_RESUMED: "border-green-200 bg-green-50",
  NEAR_DELIVERY: "border-purple-200 bg-purple-50",
  ARRIVED_DELIVERY: "border-green-200 bg-green-50",
  DEPARTED_DELIVERY: "border-green-200 bg-green-50",
  NO_LOCATION_UPDATE: "border-red-200 bg-red-50",
  TABLET_OFFLINE: "border-red-300 bg-red-100",
  ROUTE_DEVIATION_WARNING: "border-orange-200 bg-orange-50",
};

function timeAgo(ts: string): string {
  const diffMin = Math.round((Date.now() - new Date(ts).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  return `${h}h ago`;
}

export default function AlertPanel({
  alerts,
  onAcknowledge,
}: {
  alerts: AlertItem[];
  onAcknowledge: (ids: string[]) => void;
}) {
  const [showAcknowledged, setShowAcknowledged] = useState(false);

  const visible = showAcknowledged ? alerts : alerts.filter((a) => !a.acknowledged);
  const unackCount = alerts.filter((a) => !a.acknowledged).length;

  function handleAckAll() {
    const ids = alerts.filter((a) => !a.acknowledged).map((a) => a.id);
    if (ids.length) onAcknowledge(ids);
  }

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <h3 className="font-semibold text-gray-800 text-sm">
          Live Alerts
          {unackCount > 0 && (
            <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
              {unackCount}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showAcknowledged}
              onChange={(e) => setShowAcknowledged(e.target.checked)}
              className="rounded"
            />
            Show acknowledged
          </label>
          {unackCount > 0 && (
            <button
              onClick={handleAckAll}
              className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
              Ack All
            </button>
          )}
        </div>
      </div>

      <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
        {visible.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">
            No active alerts.
          </div>
        )}
        {visible.map((alert) => (
          <div
            key={alert.id}
            className={`flex items-start gap-3 px-4 py-3 border-l-4 ${
              EVENT_COLORS[alert.event_type] ?? "border-gray-200 bg-white"
            } ${alert.acknowledged ? "opacity-50" : ""}`}
          >
            <span className="text-xl flex-shrink-0 mt-0.5">
              {EVENT_ICONS[alert.event_type] ?? "🔔"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {alert.unit_number && (
                  <span className="font-semibold text-sm text-gray-900">
                    Unit {alert.unit_number}
                  </span>
                )}
                {alert.load_number && (
                  <span className="text-xs text-gray-500">#{alert.load_number}</span>
                )}
                <span className="text-xs text-gray-500">{timeAgo(alert.created_at)}</span>
              </div>
              <div className="text-sm text-gray-700 mt-0.5">
                {formatEventLabel(alert.event_type, alert.metadata)}
              </div>
            </div>
            {!alert.acknowledged && (
              <button
                onClick={() => onAcknowledge([alert.id])}
                className="flex-shrink-0 text-xs text-gray-400 hover:text-gray-700 border border-gray-200 rounded px-2 py-0.5"
              >
                Ack
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatEventLabel(eventType: string, metadata: Record<string, unknown>): string {
  const mode = metadata.tracking_mode as TrackingMode | undefined;
  switch (eventType) {
    case "NEAR_PICKUP": return "Approaching pickup location (within 5 miles)";
    case "ARRIVED_PICKUP": return "Arrived at pickup area";
    case "DEPARTED_PICKUP": return "Departed from pickup";
    case "REST_STARTED": return "Driver started rest break";
    case "REST_EXTENDED": return "Driver rest break extended";
    case "MOVEMENT_RESUMED": return "Movement resumed after rest";
    case "NEAR_DELIVERY": return "Approaching delivery location (within 5 miles)";
    case "ARRIVED_DELIVERY": return "Arrived at delivery area";
    case "DEPARTED_DELIVERY": return "Departed from delivery";
    case "NO_LOCATION_UPDATE": return "No location update for 90+ minutes";
    case "TABLET_OFFLINE": return "Tablet appears offline (3+ hours without update)";
    case "ROUTE_DEVIATION_WARNING": return "Vehicle appears to be deviating from route";
    default: return eventType.replace(/_/g, " ").toLowerCase();
  }
}

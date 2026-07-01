import type { RiskScore, AppointmentStatus, TrackingMode } from "@/lib/tracking/types";
import { formatETA } from "@/lib/tracking/eta";

// ── Risk Badge ────────────────────────────────────────────────────────────────
const RISK_COLORS: Record<RiskScore, string> = {
  low: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-red-100 text-red-800",
};

export function RiskBadge({
  score,
  reasons,
}: {
  score: RiskScore;
  reasons: string[];
}) {
  return (
    <div className="relative group inline-block">
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase ${RISK_COLORS[score]}`}
      >
        {score}
      </span>
      {reasons.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-50 min-w-48 max-w-72">
          <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 shadow-lg">
            <div className="font-semibold mb-1">Risk Reasons</div>
            <ul className="space-y-0.5">
              {reasons.map((r, i) => (
                <li key={i}>• {r}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Appointment Status Badge ──────────────────────────────────────────────────
const APPT_COLORS: Record<AppointmentStatus, string> = {
  early: "bg-blue-100 text-blue-800",
  on_time: "bg-green-100 text-green-800",
  tight: "bg-yellow-100 text-yellow-800",
  at_risk: "bg-orange-100 text-orange-800",
  late: "bg-red-100 text-red-800",
  unknown: "bg-gray-100 text-gray-500",
};

const APPT_LABELS: Record<AppointmentStatus, string> = {
  early: "Early",
  on_time: "On Time",
  tight: "Tight",
  at_risk: "At Risk",
  late: "Late",
  unknown: "Unknown",
};

export function AppointmentBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${APPT_COLORS[status]}`}
    >
      {APPT_LABELS[status]}
    </span>
  );
}

// ── Tracking Mode Badge ───────────────────────────────────────────────────────
const MODE_COLORS: Record<TrackingMode, string> = {
  moving: "bg-green-100 text-green-700",
  slow_traffic: "bg-yellow-100 text-yellow-700",
  parking_maneuver: "bg-orange-100 text-orange-700",
  parked_rest: "bg-red-100 text-red-700",
  no_active_load: "bg-gray-100 text-gray-500",
  approaching_pickup: "bg-blue-100 text-blue-700",
  approaching_delivery: "bg-purple-100 text-purple-700",
  offline: "bg-gray-200 text-gray-600",
};

const MODE_LABELS: Record<TrackingMode, string> = {
  moving: "Moving",
  slow_traffic: "Slow Traffic",
  parking_maneuver: "Maneuvering",
  parked_rest: "Resting",
  no_active_load: "No Load",
  approaching_pickup: "→ Pickup",
  approaching_delivery: "→ Delivery",
  offline: "Offline",
};

export function ModeBadge({ mode }: { mode: TrackingMode }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${MODE_COLORS[mode]}`}
    >
      {MODE_LABELS[mode]}
    </span>
  );
}

// ── ETA Refresh Button ────────────────────────────────────────────────────────
export function ETADisplay({
  loadId,
  etaMinutes,
  calculatedAt,
  onRefresh,
  loading,
}: {
  loadId: string;
  etaMinutes: number | null;
  calculatedAt: string | null;
  onRefresh: (loadId: string) => void;
  loading: boolean;
}) {
  const ageMin = calculatedAt
    ? Math.round((Date.now() - new Date(calculatedAt).getTime()) / 60_000)
    : null;
  const stale = ageMin !== null && ageMin > 14;

  return (
    <div className="flex items-center gap-1.5">
      {etaMinutes !== null ? (
        <span
          className={`text-sm font-medium ${stale ? "text-orange-500" : "text-gray-900"}`}
          title={calculatedAt ? `Calculated ${ageMin}m ago` : undefined}
        >
          {formatETA(etaMinutes)}
          {stale && <span className="text-xs ml-1">(stale)</span>}
        </span>
      ) : (
        <span className="text-sm text-gray-400">—</span>
      )}
      <button
        onClick={() => onRefresh(loadId)}
        disabled={loading}
        className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400 underline"
        title="Refresh ETA (uses Google Routes API)"
      >
        {loading ? "…" : "Refresh"}
      </button>
    </div>
  );
}

// ── Time ago helper ───────────────────────────────────────────────────────────
export function TimeAgo({ ts }: { ts: string | null }) {
  if (!ts) return <span className="text-gray-400">—</span>;
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffMin = Math.round(diffMs / 60_000);

  let label: string;
  let cls = "text-gray-600";

  if (diffMin < 2) {
    label = "Just now";
    cls = "text-green-600";
  } else if (diffMin < 10) {
    label = `${diffMin}m ago`;
    cls = "text-green-600";
  } else if (diffMin < 60) {
    label = `${diffMin}m ago`;
    cls = "text-yellow-600";
  } else if (diffMin < 180) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    label = m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
    cls = "text-orange-600";
  } else {
    const h = Math.floor(diffMin / 60);
    label = `${h}h ago`;
    cls = "text-red-600 font-semibold";
  }

  return <span className={`text-xs ${cls}`}>{label}</span>;
}

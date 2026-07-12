"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import TrackingMap, { type MapUnit } from "@/components/tracking/TrackingMap";
import TrackingTable, { type TrackingRow } from "@/components/tracking/TrackingTable";
import AlertPanel, { type AlertItem } from "@/components/tracking/AlertPanel";
import type { TrackingMode, GeofenceStatus, RiskScore, AppointmentStatus } from "@/lib/tracking/types";

interface DashboardUnit {
  unit_id: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number | null;
  accuracy: number | null;
  tracking_mode: TrackingMode;
  last_update_at: string;
  tablet_device_id: string | null;
  vehicles: {
    id: string;
    unit_number: string;
    vehicle_type: string;
  } | null;
}

interface DashboardLoad {
  id: string;
  load_id: string;
  tracking_status: string;
  geofence_status: GeofenceStatus;
  risk_score: RiskScore;
  risk_reasons: string[];
  appointment_status: AppointmentStatus;
  eta_minutes: number | null;
  eta_calculated_at: string | null;
  parked_since: string | null;
  loads: {
    id: string;
    load_number: string | null;
    vehicle_id: string | null;
    vehicles: { unit_number: string } | null;
    people: { full_name: string } | null;
  } | null;
}

interface DashboardEvent {
  id: string;
  unit_id: string | null;
  load_id: string | null;
  event_type: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  vehicles: { unit_number: string } | null;
  loads: { load_number: string | null } | null;
}

const POLL_INTERVAL_MS = 10_000;

export default function TrackingDashboard() {
  const [units, setUnits] = useState<DashboardUnit[]>([]);
  const [activeLoads, setActiveLoads] = useState<DashboardLoad[]>([]);
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [loadingETA, setLoadingETA] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/tracking/dashboard");
      if (!res.ok) return;
      const data = await res.json();
      setUnits(data.units ?? []);
      setActiveLoads(data.activeLoads ?? []);
      setEvents(data.events ?? []);
      setLastRefresh(new Date());
    } catch {
      // Silent fail — keep showing last known state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    pollRef.current = setInterval(fetchDashboard, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchDashboard]);

  async function handleRefreshETA(loadId: string) {
    setLoadingETA(loadId);
    try {
      const res = await fetch("/api/tracking/eta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ load_id: loadId }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveLoads((prev) =>
          prev.map((l) =>
            l.load_id === loadId
              ? { ...l, eta_minutes: data.eta_minutes, eta_calculated_at: data.calculated_at }
              : l,
          ),
        );
      }
    } finally {
      setLoadingETA(null);
    }
  }

  async function handleAcknowledge(ids: string[]) {
    try {
      const res = await fetch("/api/tracking/acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_ids: ids }),
      });
      if (!res.ok) return; // keep alerts visible; next poll reflects reality
    } catch {
      return;
    }
    setEvents((prev) =>
      prev.map((e) =>
        ids.includes(e.id)
          ? { ...e, acknowledged: true, acknowledged_at: new Date().toISOString() }
          : e,
      ),
    );
  }

  // Build map units
  const mapUnits: MapUnit[] = units.map((u) => {
    const activeLoad = activeLoads.find((l) => l.loads?.vehicle_id === u.unit_id);
    return {
      unit_id: u.unit_id,
      unit_number: u.vehicles?.unit_number ?? u.unit_id,
      latitude: u.latitude,
      longitude: u.longitude,
      accuracy: u.accuracy,
      tracking_mode: u.tracking_mode,
      last_update_at: u.last_update_at,
      load_number: activeLoad?.loads?.load_number ?? null,
    };
  });

  // Build table rows
  const tableRows: TrackingRow[] = activeLoads.map((lt) => {
    const unitId = lt.loads?.vehicle_id ?? null;
    const unit = unitId ? units.find((u) => u.unit_id === unitId) : null;
    const recentEvents = events.filter((e) => e.load_id === lt.load_id);
    const hasDeviation = recentEvents.some(
      (e) => e.event_type === "ROUTE_DEVIATION_WARNING" && !e.acknowledged,
    );

    return {
      load_id: lt.load_id,
      load_number: lt.loads?.load_number ?? null,
      unit_number: lt.loads?.vehicles?.unit_number ?? "—",
      driver_name: lt.loads?.people?.full_name ?? null,
      tracking_mode: unit?.tracking_mode ?? "offline",
      geofence_status: lt.geofence_status,
      last_update_at: unit?.last_update_at ?? null,
      risk_score: lt.risk_score,
      risk_reasons: lt.risk_reasons,
      appointment_status: lt.appointment_status,
      eta_minutes: lt.eta_minutes,
      eta_calculated_at: lt.eta_calculated_at,
      has_route_deviation: hasDeviation,
    };
  });

  // Build alert items
  const alertItems: AlertItem[] = events.map((e) => ({
    id: e.id,
    event_type: e.event_type,
    unit_number: e.vehicles?.unit_number ?? null,
    load_number: e.loads?.load_number ?? null,
    created_at: e.created_at,
    acknowledged: e.acknowledged,
    metadata: e.metadata,
  }));

  const unackCount = events.filter((e) => !e.acknowledged).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tracking Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeLoads.length} active load{activeLoads.length !== 1 ? "s" : ""} •{" "}
            {units.length} unit{units.length !== 1 ? "s" : ""} tracking
            {unackCount > 0 && (
              <span className="ml-2 text-red-600 font-medium">{unackCount} unacknowledged alert{unackCount !== 1 ? "s" : ""}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-gray-400">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchDashboard}
            className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400">
          Loading tracking data…
        </div>
      ) : (
        <>
          {/* Map */}
          <TrackingMap
            units={mapUnits}
            selectedUnitId={selectedUnitId}
            onSelectUnit={(id) => setSelectedUnitId(id === selectedUnitId ? null : id)}
          />

          {/* Main content: table + alerts */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">
              <TrackingTable
                rows={tableRows}
                activeFilter={activeFilter}
                onFilterChange={setActiveFilter}
                loadingETA={loadingETA}
                onRefreshETA={handleRefreshETA}
                onSelectUnit={(loadId) => {
                  const unitId = activeLoads.find((l) => l.load_id === loadId)?.loads?.vehicle_id;
                  if (unitId) setSelectedUnitId(unitId);
                }}
              />
            </div>
            <div>
              <AlertPanel
                alerts={alertItems}
                onAcknowledge={handleAcknowledge}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

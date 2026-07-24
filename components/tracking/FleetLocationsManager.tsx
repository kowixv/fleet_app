"use client";

import { useEffect, useMemo, useState } from "react";
import type { FleetLocationType, FleetLocation } from "@/lib/tracking/location-types";
import { FLEET_LOCATION_LABELS, FLEET_LOCATION_TYPES } from "@/lib/tracking/location-types";

type FormState = {
  id: string | null;
  name: string;
  location_type: FleetLocationType;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  latitude: string;
  longitude: string;
  phone: string;
  email: string;
  website: string;
  business_hours: string;
  is_24_hour: boolean;
  mobile_service: boolean;
  heavy_duty_capable: boolean;
  preferred_vendor: boolean;
  services: string;
  internal_rating: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  location_type: "mechanic_shop",
  address_line: "",
  city: "",
  state: "",
  postal_code: "",
  latitude: "",
  longitude: "",
  phone: "",
  email: "",
  website: "",
  business_hours: "",
  is_24_hour: false,
  mobile_service: false,
  heavy_duty_capable: true,
  preferred_vendor: false,
  services: "",
  internal_rating: "",
  notes: "",
};

function formFromLocation(location: FleetLocation): FormState {
  return {
    id: location.id,
    name: location.name,
    location_type: location.location_type,
    address_line: location.address_line ?? "",
    city: location.city ?? "",
    state: location.state ?? "",
    postal_code: location.postal_code ?? "",
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    phone: location.phone ?? "",
    email: location.email ?? "",
    website: location.website ?? "",
    business_hours: location.business_hours ?? "",
    is_24_hour: location.is_24_hour,
    mobile_service: location.mobile_service,
    heavy_duty_capable: location.heavy_duty_capable,
    preferred_vendor: location.preferred_vendor,
    services: location.services.join(", "),
    internal_rating: location.internal_rating === null ? "" : String(location.internal_rating),
    notes: location.notes ?? "",
  };
}

export default function FleetLocationsManager({
  open,
  mapDraft,
  placementActive,
  onStartPlacement,
  onStopPlacement,
  onChanged,
  onClose,
}: {
  open: boolean;
  mapDraft: { latitude: number; longitude: number } | null;
  placementActive: boolean;
  onStartPlacement: () => void;
  onStopPlacement: () => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [locations, setLocations] = useState<FleetLocation[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [filterType, setFilterType] = useState<"all" | FleetLocationType>("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    void loadLocations();
  }, [open]);

  useEffect(() => {
    if (!mapDraft) return;
    setForm((prev) => ({
      ...prev,
      latitude: mapDraft.latitude.toFixed(6),
      longitude: mapDraft.longitude.toFixed(6),
    }));
  }, [mapDraft]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return locations.filter((location) => {
      if (filterType !== "all" && location.location_type !== filterType) return false;
      if (!needle) return true;
      return [location.name, location.city, location.state]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [filterType, locations, search]);

  if (!open) return null;

  async function loadLocations() {
    const res = await fetch("/api/tracking/locations?include_inactive=1");
    if (!res.ok) return;
    const data = await res.json();
    setLocations(data.locations ?? []);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function geocodeFormAddress() {
    setBusy(true);
    setMessage("");
    const address = [form.address_line, form.city, form.state, form.postal_code].filter(Boolean).join(", ");
    try {
      const res = await fetch("/api/tracking/locations/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "No geocode result found.");
        return;
      }
      setForm((prev) => ({ ...prev, latitude: String(data.lat), longitude: String(data.lng) }));
      setMessage("Coordinates found. Review them before saving.");
    } finally {
      setBusy(false);
    }
  }

  async function saveLocation() {
    setBusy(true);
    setMessage("");
    const payload = {
      ...form,
      services: form.services.split(",").map((item) => item.trim()).filter(Boolean),
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      internal_rating: form.internal_rating ? Number(form.internal_rating) : null,
    };
    try {
      const res = await fetch(form.id ? `/api/tracking/locations/${form.id}` : "/api/tracking/locations", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Location could not be saved.");
        return;
      }
      setForm(EMPTY_FORM);
      onStopPlacement();
      await loadLocations();
      onChanged();
      setMessage("Saved.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivateLocation(id: string) {
    if (!confirm("Deactivate this saved place?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tracking/locations/${id}`, { method: "DELETE" });
      if (res.ok) {
        await loadLocations();
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Saved Places</h2>
          <p className="text-sm text-gray-500">Yards, mechanics, towing, fuel, parking, and other fleet support locations.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-600">
          Close
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              className="rounded border border-gray-200 px-3 py-2 text-sm"
              placeholder="Search name, city, state"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className="rounded border border-gray-200 px-3 py-2 text-sm"
              value={filterType}
              onChange={(event) => setFilterType(event.target.value as "all" | FleetLocationType)}
            >
              <option value="all">All types</option>
              {FLEET_LOCATION_TYPES.map((type) => (
                <option key={type} value={type}>{FLEET_LOCATION_LABELS[type]}</option>
              ))}
            </select>
          </div>

          <div className="max-h-96 overflow-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">City</th>
                  <th className="px-3 py-2 text-left">Flags</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 && (
                  <tr><td className="px-3 py-6 text-center text-gray-400" colSpan={5}>No saved places.</td></tr>
                )}
                {filtered.map((location) => (
                  <tr key={location.id} className={location.active ? "" : "opacity-50"}>
                    <td className="px-3 py-2 font-medium text-gray-900">{location.name}</td>
                    <td className="px-3 py-2 text-gray-600">{FLEET_LOCATION_LABELS[location.location_type]}</td>
                    <td className="px-3 py-2 text-gray-600">{[location.city, location.state].filter(Boolean).join(", ") || "-"}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {[
                        location.preferred_vendor ? "Preferred" : null,
                        location.is_24_hour ? "24/7" : null,
                        location.mobile_service ? "Mobile" : null,
                      ].filter(Boolean).join(", ") || "-"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="mr-3 text-blue-600 hover:underline" onClick={() => setForm(formFromLocation(location))}>Edit</button>
                      {location.active && (
                        <button type="button" className="text-red-600 hover:underline" onClick={() => deactivateLocation(location.id)}>Deactivate</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-gray-200 p-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">{form.id ? "Edit Place" : "Add Place"}</h3>
            <button type="button" onClick={() => setForm(EMPTY_FORM)} className="text-xs text-gray-500 hover:text-gray-800">Clear</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" className="col-span-2"><input className="input" value={form.name} onChange={(e) => setField("name", e.target.value)} /></Field>
            <Field label="Type"><select className="input" value={form.location_type} onChange={(e) => setField("location_type", e.target.value as FleetLocationType)}>{FLEET_LOCATION_TYPES.map((type) => <option key={type} value={type}>{FLEET_LOCATION_LABELS[type]}</option>)}</select></Field>
            <Field label="Internal Rating"><input className="input" type="number" min="1" max="5" step="0.1" value={form.internal_rating} onChange={(e) => setField("internal_rating", e.target.value)} /></Field>
            <Field label="Street Address" className="col-span-2"><input className="input" value={form.address_line} onChange={(e) => setField("address_line", e.target.value)} /></Field>
            <Field label="City"><input className="input" value={form.city} onChange={(e) => setField("city", e.target.value)} /></Field>
            <Field label="State"><input className="input" value={form.state} onChange={(e) => setField("state", e.target.value)} /></Field>
            <Field label="ZIP"><input className="input" value={form.postal_code} onChange={(e) => setField("postal_code", e.target.value)} /></Field>
            <div className="flex items-end gap-2">
              <button type="button" disabled={busy} onClick={geocodeFormAddress} className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Geocode Address</button>
            </div>
            <Field label="Latitude"><input className="input" type="number" step="any" value={form.latitude} onChange={(e) => setField("latitude", e.target.value)} /></Field>
            <Field label="Longitude"><input className="input" type="number" step="any" value={form.longitude} onChange={(e) => setField("longitude", e.target.value)} /></Field>
            <div className="col-span-2">
              <button
                type="button"
                onClick={placementActive ? onStopPlacement : onStartPlacement}
                className={`rounded px-3 py-2 text-sm font-medium ${placementActive ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-700"}`}
              >
                {placementActive ? "Map click mode on" : "Click map to place location"}
              </button>
            </div>
            <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setField("phone", e.target.value)} /></Field>
            <Field label="Email"><input className="input" value={form.email} onChange={(e) => setField("email", e.target.value)} /></Field>
            <Field label="Website"><input className="input" value={form.website} onChange={(e) => setField("website", e.target.value)} /></Field>
            <Field label="Business Hours"><input className="input" value={form.business_hours} onChange={(e) => setField("business_hours", e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={form.is_24_hour} onChange={(e) => setField("is_24_hour", e.target.checked)} />24/7</label>
            <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={form.mobile_service} onChange={(e) => setField("mobile_service", e.target.checked)} />Mobile Service</label>
            <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={form.heavy_duty_capable} onChange={(e) => setField("heavy_duty_capable", e.target.checked)} />Heavy Duty</label>
            <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={form.preferred_vendor} onChange={(e) => setField("preferred_vendor", e.target.checked)} />Preferred Vendor</label>
            <Field label="Services" className="col-span-2"><input className="input" placeholder="PM, tires, roadside" value={form.services} onChange={(e) => setField("services", e.target.value)} /></Field>
            <Field label="Notes" className="col-span-2"><textarea className="input" rows={3} value={form.notes} onChange={(e) => setField("notes", e.target.value)} /></Field>
          </div>
          {message && <p className="text-sm text-gray-600">{message}</p>}
          <div className="flex justify-end">
            <button type="button" disabled={busy} onClick={saveLocation} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Saving..." : "Save Place"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}

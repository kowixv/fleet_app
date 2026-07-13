"use client";

import { updateMileage } from "@/app/(app)/maintenance/actions";
import { validateMileageInput } from "@/lib/vehicle-mileage";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

interface VehicleMileageRow {
  id: string;
  unit_number: string;
  current_mileage: number | string | null;
}

interface RowMessage {
  type: "success" | "error";
  text: string;
}

function displayMileage(value: number | string | null) {
  if (value === null || value === undefined || value === "") return "-";
  return `${Number(value).toLocaleString("en-US")} mi`;
}

export default function VehicleMileageManager({ vehicles }: { vehicles: VehicleMileageRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(vehicles.map((vehicle) => [vehicle.id, String(vehicle.current_mileage ?? "")])),
  );
  const [messages, setMessages] = useState<Record<string, RowMessage>>({});

  const vehicleById = useMemo(
    () => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])),
    [vehicles],
  );

  useEffect(() => {
    setValues(Object.fromEntries(vehicles.map((vehicle) => [vehicle.id, String(vehicle.current_mileage ?? "")])));
  }, [vehicles]);

  async function save(vehicleId: string) {
    const vehicle = vehicleById.get(vehicleId);
    if (!vehicle) return;

    const parsed = validateMileageInput(values[vehicleId]);
    if (!parsed.ok) {
      setMessages((current) => ({ ...current, [vehicleId]: { type: "error", text: parsed.error } }));
      return;
    }

    const currentMileage = Number(vehicle.current_mileage ?? 0);
    if (parsed.mileage < currentMileage) {
      setMessages((current) => ({
        ...current,
        [vehicleId]: { type: "error", text: "Mileage mevcut odometreden dusuk olamaz." },
      }));
      return;
    }

    setSavingId(vehicleId);
    setMessages((current) => ({ ...current, [vehicleId]: { type: "success", text: "" } }));
    const result = await updateMileage(vehicleId, parsed.mileage);
    setSavingId(null);

    if (!result.ok) {
      setMessages((current) => ({ ...current, [vehicleId]: { type: "error", text: result.error } }));
      return;
    }

    setMessages((current) => ({
      ...current,
      [vehicleId]: { type: "success", text: `Mileage kaydedildi: ${result.mileage.toLocaleString("en-US")} mi` },
    }));
    startTransition(() => router.refresh());
  }

  if (vehicles.length === 0) return null;

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold">Current Mileage</h2>
        <p className="text-sm text-slate-500">
          Arac odometresini bakim kurali olmadan guvenli audit RPC ile guncelle.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Unit</th>
              <th className="th">Mevcut Mileage</th>
              <th className="th">Current Mileage</th>
              <th className="th text-right">Islem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vehicles.map((vehicle) => {
              const message = messages[vehicle.id];
              const busy = savingId === vehicle.id || isPending;
              return (
                <tr key={vehicle.id}>
                  <td className="td font-medium">Unit {vehicle.unit_number}</td>
                  <td className="td">{displayMileage(vehicle.current_mileage)}</td>
                  <td className="td">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={values[vehicle.id] ?? ""}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [vehicle.id]: event.target.value }))
                      }
                      className="input max-w-40"
                      aria-label={`Unit ${vehicle.unit_number} current mileage`}
                    />
                    {message?.text && (
                      <p
                        className={`mt-1 text-xs ${
                          message.type === "success" ? "text-emerald-700" : "text-red-600"
                        }`}
                      >
                        {message.text}
                      </p>
                    )}
                  </td>
                  <td className="td text-right">
                    <button
                      type="button"
                      onClick={() => save(vehicle.id)}
                      disabled={busy}
                      className="btn-primary whitespace-nowrap"
                    >
                      {savingId === vehicle.id ? "Kaydediliyor..." : "Mileage Kaydet"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

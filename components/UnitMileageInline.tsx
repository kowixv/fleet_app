"use client";

import { updateMileage } from "@/app/(app)/maintenance/actions";
import { validateMileageInput } from "@/lib/vehicle-mileage";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export default function UnitMileageInline({
  vehicleId,
  unitNumber,
  currentMileage,
}: {
  vehicleId: string;
  unitNumber: string;
  currentMileage: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentMileage == null ? "" : String(currentMileage));
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    const parsed = validateMileageInput(value);
    if (!parsed.ok) {
      setMessage({ type: "error", text: parsed.error });
      return;
    }
    if (currentMileage != null && parsed.mileage < currentMileage) {
      setMessage({ type: "error", text: "Mileage mevcut odometreden düşük olamaz." });
      return;
    }
    startTransition(async () => {
      const result = await updateMileage(vehicleId, parsed.mileage);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setMessage({ type: "ok", text: "Mileage kaydedildi." });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xl font-bold">
          {currentMileage == null ? "-" : Number(currentMileage).toLocaleString("en-US")} mi
        </span>
        <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(true)}>
          Mileage Güncelle
        </button>
      </div>
      {message && (
        <p className={`text-xs ${message.type === "ok" ? "text-emerald-700" : "text-red-600"}`}>{message.text}</p>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="card w-full max-w-sm space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Unit {unitNumber} Mileage</h2>
              <button type="button" className="text-slate-400" onClick={() => setOpen(false)}>x</button>
            </div>
            <input
              className="input"
              type="number"
              min={0}
              step={1}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
            />
            <p className="text-xs text-slate-500">Güvenli RPC ve audit kaydı ile güncellenir. Daha düşük mileage kabul edilmez.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>İptal</button>
              <button type="button" className="btn-primary" disabled={pending} onClick={save}>
                {pending ? "Kaydediliyor..." : "Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

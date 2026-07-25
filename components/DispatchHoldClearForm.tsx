"use client";

import { clearVehicleDispatchHold } from "@/app/(app)/maintenance/inspection-actions";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export default function DispatchHoldClearForm({ holdId }: { holdId: string }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const formData = new FormData();
    formData.set("hold_id", holdId);
    formData.set("clearance_notes", notes);
    startTransition(async () => {
      const result = await clearVehicleDispatchHold(formData);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setNotes("");
      setMessage("Dispatch hold temizlendi. Audit kaydı korunuyor.");
      router.refresh();
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <div className="min-w-64 flex-1">
        <label className="label" htmlFor={`clearance-${holdId}`}>Temizleme notu</label>
        <input
          id={`clearance-${holdId}`}
          className="input"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Onarım ve güvenlik doğrulaması"
        />
      </div>
      <button type="button" className="btn-ghost" disabled={pending || notes.trim().length < 3} onClick={submit}>
        {pending ? "Temizleniyor…" : "Hold'u Temizle"}
      </button>
      {message && <p className="basis-full text-xs text-slate-600" aria-live="polite">{message}</p>}
    </div>
  );
}

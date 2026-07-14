"use client";

import {
  deactivateVehicle,
  permanentlyDeleteUnusedVehicle,
  reactivateVehicle,
} from "@/app/(app)/vehicles/actions";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface VehicleRow {
  id: string;
  unit_number: string;
  status: string | null;
}

function statusBadge(status: string | null) {
  if (status === "inactive") return <span className="badge bg-slate-100 text-slate-700">Pasif</span>;
  if (status === "in_repair") return <span className="badge bg-amber-100 text-amber-700">Tamirde</span>;
  return null;
}

export default function VehicleRemovalActions({
  row,
  startEdit,
  canPermanentDelete = false,
}: {
  row: VehicleRow;
  startEdit: (row: VehicleRow) => void;
  canPermanentDelete?: boolean;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<"deactivate" | "permanent" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const isInactive = row.status === "inactive";

  function runDeactivate() {
    setMessage(null);
    startTransition(async () => {
      const result = await deactivateVehicle(row.id);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setModal(null);
      setMessage({ type: "ok", text: result.message });
      router.refresh();
    });
  }

  function runReactivate() {
    setMessage(null);
    startTransition(async () => {
      const result = await reactivateVehicle(row.id);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setMessage({ type: "ok", text: result.message });
      router.refresh();
    });
  }

  function runPermanentDelete() {
    setMessage(null);
    startTransition(async () => {
      const result = await permanentlyDeleteUnusedVehicle(row.id, confirmation);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        if ((result as any).deactivated) {
          setModal(null);
          router.refresh();
        }
        return;
      }
      setModal(null);
      setMessage({ type: "ok", text: result.message });
      router.refresh();
    });
  }

  return (
    <div className="inline-flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-3">
        {statusBadge(row.status)}
        <button onClick={() => startEdit(row)} className="text-brand hover:underline">
          Düzenle
        </button>
        {isInactive ? (
          <>
            <button onClick={runReactivate} disabled={isPending} className="text-emerald-700 hover:underline">
              {isPending ? "İşleniyor..." : "Tekrar Aktif Et"}
            </button>
            {canPermanentDelete && (
              <button onClick={() => setModal("permanent")} className="text-red-700 hover:underline">
                Kalıcı Olarak Sil
              </button>
            )}
          </>
        ) : (
          <button onClick={() => setModal("deactivate")} className="text-red-700 hover:underline">
            Listeden Kaldır
          </button>
        )}
      </div>
      {message && (
        <p className={`max-w-sm text-right text-xs ${message.type === "ok" ? "text-emerald-700" : "text-red-700"}`}>
          {message.text}
        </p>
      )}

      {modal === "deactivate" && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 text-left">
          <div className="card my-8 w-full max-w-lg">
            <h2 className="text-lg font-semibold">Unit {row.unit_number} listeden kaldırılsın mı?</h2>
            <p className="mt-2 text-sm text-slate-600">
              Unit pasife alınacak ve normal listelerde görünmeyecek. Bakım, mileage, invoice, load ve maliyet geçmişi korunacak.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setModal(null)}>
                İptal
              </button>
              <button type="button" className="btn-primary bg-red-700 hover:bg-red-800" disabled={isPending} onClick={runDeactivate}>
                {isPending ? "İşleniyor..." : "Unit'i Pasife Al"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "permanent" && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 text-left">
          <div className="card my-8 w-full max-w-lg">
            <h2 className="text-lg font-semibold">Unit {row.unit_number} kalıcı olarak silinsin mi?</h2>
            <p className="mt-2 text-sm text-slate-600">
              Bu işlem sadece hiç operasyonel veya geçmiş kaydı olmayan unitler için yapılır. Onay için Unit numarasını aynen yazın.
            </p>
            <input
              className="input mt-3"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={row.unit_number}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setModal(null)}>
                İptal
              </button>
              <button type="button" className="btn-primary bg-red-700 hover:bg-red-800" disabled={isPending} onClick={runPermanentDelete}>
                {isPending ? "İşleniyor..." : "Kalıcı Olarak Sil"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { setSettlementStatus, deleteSettlement } from "../actions";

export default function StatusActions({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const locked = status === "paid";

  const change = (s: string) =>
    start(async () => {
      setError(null);
      const res = await setSettlementStatus(id, s);
      if (res?.error) setError(res.error);
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status !== "finalized" && status !== "paid" && (
          <button onClick={() => change("finalized")} disabled={pending} className="btn-primary text-sm">
            Finalize
          </button>
        )}
        {status === "finalized" && (
          <button onClick={() => change("paid")} disabled={pending} className="btn-primary text-sm">
            Paid olarak işaretle
          </button>
        )}
        {!locked && (
          <button onClick={() => change("pending_review")} disabled={pending} className="btn-ghost text-sm">
            Review'a al
          </button>
        )}
        {status !== "void" && (
          <button onClick={() => change("void")} disabled={pending} className="btn-ghost text-sm text-red-600">
            Void
          </button>
        )}
        {status !== "finalized" && status !== "paid" && (
          <button
            onClick={() => {
              if (confirm("Settlement silinsin mi? Bağlı load/masraflar serbest bırakılır."))
                start(async () => {
                  setError(null);
                  const res = await deleteSettlement(id);
                  if (res?.error) setError(res.error);
                });
            }}
            disabled={pending}
            className="btn-ghost text-sm text-red-600"
          >
            Sil
          </button>
        )}
      </div>
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

"use client";

import { useTransition } from "react";
import { setSettlementStatus, deleteSettlement } from "../actions";

export default function StatusActions({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const [pending, start] = useTransition();
  const locked = status === "paid";

  const change = (s: string) => start(() => void setSettlementStatus(id, s));

  return (
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
              start(() => void deleteSettlement(id));
          }}
          disabled={pending}
          className="btn-ghost text-sm text-red-600"
        >
          Sil
        </button>
      )}
    </div>
  );
}

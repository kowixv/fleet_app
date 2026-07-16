"use client";

import { useState, useTransition } from "react";
import { deleteDraftSettlement, updateSettlementStatus, voidSettlement } from "../actions";

const NEXT_STATUSES: Record<string, string[]> = {
  draft: ["pending_review", "finalized", "void"],
  pending_review: ["draft", "finalized", "void"],
  finalized: ["paid", "void"],
  paid: ["void"],
  void: [],
};

const LABELS: Record<string, string> = {
  draft: "Draft",
  pending_review: "Review",
  finalized: "Finalize",
  paid: "Mark Paid",
  void: "Void",
};

export default function StatusActions({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const nextStatuses = NEXT_STATUSES[status] ?? [];
  const canDelete = status === "draft" || status === "pending_review";

  function change(next: string) {
    start(async () => {
      setError(null);
      const result = next === "void"
        ? await voidSettlement(id, voidReason)
        : await updateSettlementStatus(id, next);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-3">
      {nextStatuses.includes("void") && (
        <div>
          <label className="label">Void reason</label>
          <input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} className="input" placeholder="Required before void" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {nextStatuses.map((next) => (
          <button
            key={next}
            onClick={() => change(next)}
            disabled={pending || (next === "void" && voidReason.trim().length < 3)}
            className={next === "void" ? "btn-ghost text-sm text-red-600" : "btn-primary text-sm"}
          >
            {LABELS[next] ?? next}
          </button>
        ))}
        {canDelete && (
          <button
            onClick={() => {
              if (confirm("Delete this Draft/Review settlement? Linked usage will be removed atomically.")) {
                start(async () => {
                  setError(null);
                  const result = await deleteDraftSettlement(id);
                  if (result?.error) setError(result.error);
                });
              }
            }}
            disabled={pending}
            className="btn-ghost text-sm text-red-600"
          >
            Delete Draft
          </button>
        )}
      </div>
      {status === "void" && <p className="text-xs text-slate-500">Void is terminal. This settlement cannot be reopened.</p>}
      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

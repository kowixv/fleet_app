"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveAmazonImportBatchAction, reconcileAmazonImportBatchAction, retryAmazonImportBatchAction } from "../actions";
import WorkflowActionResult from "./workflow-action-result";

export default function BatchOperations({
  batchId,
  status,
  canMutate,
}: {
  batchId: string;
  status: string;
  canMutate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "ok" | "error" | "info"; text: string } | null>(null);

  function archive() {
    if (!confirm("Archive this Amazon import batch? History, files, projections, candidates, and statements remain available.")) return;
    run(() => archiveAmazonImportBatchAction(batchId), "Batch archived.");
  }

  function retry() {
    if (!confirm("Retry this failed Amazon import batch through the controlled batch transition RPC?")) return;
    run(() => retryAmazonImportBatchAction(batchId), "Batch returned to uploaded status.");
  }

  function reconcile() {
    if (!confirm("Run payment/trip matching and canonical revenue reconciliation for this parsed batch? This is safe to run again.")) return;
    run(() => reconcileAmazonImportBatchAction(batchId), "Payment/trip reconciliation refreshed.");
  }

  function run(action: () => Promise<{ ok: true; data: unknown } | { ok: false; error: { message: string } }>, okText: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setMessage({ type: "error", text: result.error.message });
        return;
      }
      setMessage({ type: "ok", text: okText });
      router.refresh();
    });
  }

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold">Batch operations</h2>
        <p className="text-sm text-slate-500">Status transitions are server-controlled; the browser never submits arbitrary status values.</p>
      </div>
      {!canMutate ? <WorkflowActionResult type="info" message="Read-only access. Viewer users cannot retry or archive batches." /> : null}
      {message ? <WorkflowActionResult type={message.type} message={message.text} /> : null}
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" type="button" disabled={!canMutate || pending || status !== "failed"} onClick={retry}>Retry failed parsing</button>
        <button className="btn-primary" type="button" disabled={!canMutate || pending || !["parsed", "needs_review", "reconciled"].includes(status)} onClick={reconcile}>Run reconciliation / matching</button>
        <button className="btn-ghost" type="button" disabled={!canMutate || pending || status === "archived"} onClick={archive}>Archive batch</button>
      </div>
    </section>
  );
}

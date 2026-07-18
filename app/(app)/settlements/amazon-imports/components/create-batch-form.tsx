"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAmazonImportBatchAction } from "../actions";
import WorkflowActionResult from "./workflow-action-result";

export default function CreateBatchForm({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    const periodStart = String(formData.get("periodStart") ?? "");
    const periodEnd = String(formData.get("periodEnd") ?? "");
    const notes = String(formData.get("notes") ?? "");
    if (periodStart && periodEnd && periodStart > periodEnd) {
      setError("Period start must not be after period end.");
      return;
    }
    startTransition(async () => {
      const result = await createAmazonImportBatchAction({ periodStart, periodEnd, notes });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push(`/settlements/amazon-imports/${result.data.batchId}`);
    });
  }

  if (!canCreate) {
    return <WorkflowActionResult type="info" message="You have read-only access. Viewer users can inspect Amazon imports but cannot create batches." />;
  }

  return (
    <form action={submit} className="card grid gap-4 md:grid-cols-2">
      <div>
        <label className="label" htmlFor="periodStart">Period start</label>
        <input id="periodStart" name="periodStart" type="date" required className="input" aria-describedby="period-help" />
      </div>
      <div>
        <label className="label" htmlFor="periodEnd">Period end</label>
        <input id="periodEnd" name="periodEnd" type="date" required className="input" aria-describedby="period-help" />
      </div>
      <p id="period-help" className="text-xs text-slate-500 md:col-span-2">
        Organization, creator, and initial workflow status are assigned by the server.
      </p>
      <div className="md:col-span-2">
        <label className="label" htmlFor="notes">Safe notes</label>
        <textarea id="notes" name="notes" className="input min-h-24" placeholder="Optional internal note. Do not paste raw source rows." />
      </div>
      {error ? <div className="md:col-span-2"><WorkflowActionResult type="error" message={error} /></div> : null}
      <div className="md:col-span-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Creating..." : "Create Amazon import batch"}</button>
      </div>
    </form>
  );
}

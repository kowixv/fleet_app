"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usd } from "@/lib/format";
import { applyAmazonProjectionAction } from "../actions";
import WorkflowActionResult from "./workflow-action-result";

type ProjectionView = {
  revenue: Record<string, number | string>;
  fuel: Record<string, number | string>;
};

export default function ProjectionSummary({
  batchId,
  projection,
  canMutate,
  blocked,
}: {
  batchId: string;
  projection: ProjectionView;
  canMutate: boolean;
  blocked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "ok" | "error" | "info"; text: string } | null>(null);
  const revenueRevision = String(projection.revenue.previewRevision ?? "");
  const fuelRevision = String(projection.fuel.previewRevision ?? "");

  function applyProjection() {
    if (!confirm("Apply projection for this batch? This creates pending loads/expenses only. It does not create a settlement.")) return;
    setMessage(null);
    startTransition(async () => {
      const result = await applyAmazonProjectionAction({
        batchId,
        expectedRevenuePreviewRevision: revenueRevision,
        expectedFuelPreviewRevision: fuelRevision,
      });
      if (!result.ok) {
        setMessage({ type: "error", text: result.error.message });
        return;
      }
      const created = result.data.revenue.created + result.data.fuel.created;
      const unchanged = result.data.revenue.unchanged + result.data.fuel.unchanged;
      const conflicts = result.data.revenue.conflicts + result.data.fuel.conflicts;
      setMessage({ type: conflicts ? "info" : "ok", text: `Projection result: ${created} created, ${unchanged} unchanged, ${conflicts} conflicts.` });
      router.refresh();
    });
  }

  return (
    <section className="space-y-4">
      <div className="card flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-semibold">Projection</h2>
          <p className="text-sm text-slate-500">Server preview revisions: revenue {revenueRevision || "-"} / fuel {fuelRevision || "-"}. Browser totals are ignored.</p>
        </div>
        <button className="btn-primary" type="button" disabled={!canMutate || blocked || pending} onClick={applyProjection}>
          {pending ? "Applying..." : "Apply Projection"}
        </button>
      </div>
      {!canMutate ? <WorkflowActionResult type="info" message="Read-only access. Viewer users cannot apply projections." /> : null}
      {blocked ? <WorkflowActionResult type="error" message="Blocking financial or reference issues must be reviewed before projection apply." /> : null}
      {message ? <WorkflowActionResult type={message.type} message={message.text} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
      <ProjectionCard
        title="Revenue projection"
        rows={[
          ["Eligible canonical items", projection.revenue.eligibleCanonicalItemCount],
          ["Prospective loads", projection.revenue.prospectiveLoadCount],
          ["Gross amount", usd(Number(projection.revenue.grossAmount ?? 0))],
          ["Already projected amount", usd(Number(projection.revenue.alreadyProjectedAmount ?? 0))],
          ["Unchanged", projection.revenue.unchangedCount],
          ["Conflicts", projection.revenue.conflictCount],
          ["Skipped", projection.revenue.skippedCount],
          ["Projected but not settlement-ready", projection.revenue.notSettlementReadyCount],
        ]}
      />
      <ProjectionCard
        title="Fuel projection"
        rows={[
          ["Eligible product lines", projection.fuel.eligibleProductLineCount],
          ["Prospective expenses", projection.fuel.prospectiveExpenseCount],
          ["Amount", usd(Number(projection.fuel.amount ?? 0))],
          ["Placeholder skips", projection.fuel.placeholderSkips],
          ["Credit/refund issues", projection.fuel.creditRefundIssues],
          ["Unchanged", projection.fuel.unchangedCount],
          ["Conflicts", projection.fuel.conflictCount],
          ["Projected but not deduction-ready", projection.fuel.notDeductionReadyCount],
        ]}
      />
      </div>
    </section>
  );
}

function ProjectionCard({ title, rows }: { title: string; rows: Array<[string, string | number]> }) {
  return (
    <div className="card">
      <h2 className="mb-3 font-semibold">{title}</h2>
      <dl className="space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 rounded border border-slate-100 bg-slate-50 p-2">
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-slate-500">Projection creates pending operational rows only; candidate and settlement creation are separate explicit steps.</p>
    </div>
  );
}

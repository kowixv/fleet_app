import type { ReactNode } from "react";
import { usd } from "@/lib/format";
import AmazonImportStatusBadge from "./amazon-import-status-badge";

type Values = Record<string, number | string>;

function value(row: Values, key: string) {
  return row[key] ?? 0;
}

export default function ReconciliationSummary({ revenue, fuel }: { revenue: Values; fuel: Values }) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Amazon revenue reconciliation</h2>
          <AmazonImportStatusBadge status={String(value(revenue, "status") || "not_started")} />
        </div>
        <dl className="grid gap-2 text-sm md:grid-cols-2">
          <Metric label="Summary invoice total" value={usd(Number(value(revenue, "summaryInvoiceTotal")))} />
          <Metric label="Valid payment-row total" value={usd(Number(value(revenue, "validPaymentRowTotal")))} />
          <Metric label="Canonical revenue total" value={usd(Number(value(revenue, "canonicalRevenueTotal")))} />
          <Metric label="Unassigned revenue" value={usd(Number(value(revenue, "unassignedRevenue")))} />
          <Metric label="Canonical items" value={String(value(revenue, "canonicalRevenueItemCount"))} />
          <Metric label="Exact / inferred" value={`${value(revenue, "exact")} / ${value(revenue, "inferred")}`} />
          <Metric label="Ambiguous" value={String(value(revenue, "ambiguous"))} />
          <Metric label="Unmatched" value={String(value(revenue, "unmatched"))} />
        </dl>
      </div>
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Fuel reconciliation</h2>
          <AmazonImportStatusBadge status={String(value(fuel, "financialStatus") || "not_started")} />
        </div>
        <dl className="grid gap-2 text-sm md:grid-cols-2">
          <Metric label="Reported transactions" value={String(value(fuel, "reportedTransactionCount"))} />
          <Metric label="Real transactions" value={String(value(fuel, "realParsedTransactionCount"))} />
          <Metric label="Product lines" value={String(value(fuel, "productLineCount"))} />
          <Metric label="Reported amount" value={usd(Number(value(fuel, "reportedAmount")))} />
          <Metric label="Calculated amount" value={usd(Number(value(fuel, "calculatedAmount")))} />
          <Metric label="Quantity status" value={<AmazonImportStatusBadge status={String(value(fuel, "quantityStatus") || "not_started")} />} />
          <Metric label="Discount status" value={<AmazonImportStatusBadge status={String(value(fuel, "discountStatus") || "not_started")} />} />
          <Metric label="Transaction-count status" value={<AmazonImportStatusBadge status={String(value(fuel, "transactionCountStatus") || "not_started")} />} />
        </dl>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded border border-slate-100 bg-slate-50 p-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}

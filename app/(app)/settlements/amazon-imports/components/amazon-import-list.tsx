import Link from "next/link";
import { shortDate, usd } from "@/lib/format";
import type { AmazonImportListItem } from "@/lib/amazon-statements/server/ui-read-service";
import AmazonImportStatusBadge from "./amazon-import-status-badge";

export default function AmazonImportList({ rows }: { rows: AmazonImportListItem[] }) {
  if (rows.length === 0) {
    return (
      <div className="card text-sm text-slate-500">
        No Amazon imports yet. Create the first weekly batch, then upload the Amazon Payment workbook, Trips CSV, and fuel report.
      </div>
    );
  }
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[980px]">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="th">Statement period</th>
            <th className="th">Status</th>
            <th className="th">Files</th>
            <th className="th">Payment</th>
            <th className="th">Fuel</th>
            <th className="th text-right">Issues</th>
            <th className="th text-right">Revenue</th>
            <th className="th text-right">Projection</th>
            <th className="th text-right">Candidates</th>
            <th className="th">Updated</th>
            <th className="th">Creator</th>
            <th className="th"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              <td className="td font-medium">{row.period}</td>
              <td className="td"><AmazonImportStatusBadge status={row.status} /></td>
              <td className="td">{row.sourceFileCompleteness}</td>
              <td className="td"><AmazonImportStatusBadge status={row.paymentReconciliationStatus} /></td>
              <td className="td"><AmazonImportStatusBadge status={row.fuelReconciliationStatus} /></td>
              <td className="td text-right">
                <span className="text-red-700">{row.blockingIssueCount}</span>
                <span className="text-slate-400"> / </span>
                <span className="text-amber-700">{row.warningCount}</span>
              </td>
              <td className="td text-right">{usd(row.canonicalRevenueTotal)}</td>
              <td className="td text-right">{row.projectedLoadCount} loads / {row.projectedFuelExpenseCount} fuel</td>
              <td className="td text-right">{row.candidateCount}</td>
              <td className="td">{shortDate(row.lastUpdated)}</td>
              <td className="td">{row.creator}</td>
              <td className="td text-right">
                <Link href={`/settlements/amazon-imports/${row.id}`} className="text-brand hover:underline">Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

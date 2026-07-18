import type { AmazonBatchDetailView } from "@/lib/amazon-statements/server/ui-read-service";
import AmazonImportStatusBadge from "./amazon-import-status-badge";

export default function IssueSummary({ issues }: { issues: AmazonBatchDetailView["issues"] }) {
  return (
    <section className="card overflow-x-auto p-0">
      <h2 className="p-4 font-semibold">Issue summary</h2>
      <table className="w-full min-w-[640px]">
        <thead className="border-y border-slate-200 bg-slate-50">
          <tr>
            <th className="th">Category</th>
            <th className="th text-right">Unique root issues</th>
            <th className="th text-right">Affected dependencies</th>
            <th className="th">Severity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {issues.map((issue) => (
            <tr key={issue.category}>
              <td className="td">{issue.label}</td>
              <td className="td text-right font-semibold">{issue.uniqueRootCount}</td>
              <td className="td text-right">{issue.affectedDependencyCount}</td>
              <td className="td"><AmazonImportStatusBadge status={issue.severity} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 pb-4 text-xs text-slate-500">
        Root counts represent distinct manual review tasks. Dependency counts show how many rows or display paths are affected.
      </p>
    </section>
  );
}

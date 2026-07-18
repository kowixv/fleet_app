import { shortDate } from "@/lib/format";
import type { AmazonBatchDetailView } from "@/lib/amazon-statements/server/ui-read-service";

export default function HistoryTimeline({ history }: { history: AmazonBatchDetailView["history"] }) {
  return (
    <section className="card overflow-x-auto p-0">
      <div className="p-4">
        <h2 className="font-semibold">History</h2>
        <p className="text-sm text-slate-500">Safe workflow events only; raw snapshots, storage paths, hashes, and private source rows are hidden.</p>
      </div>
      <table className="w-full min-w-[720px]">
        <thead className="border-y border-slate-200 bg-slate-50">
          <tr>
            <th className="th">Action</th>
            <th className="th">Actor</th>
            <th className="th">Time</th>
            <th className="th">Result</th>
            <th className="th">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {history.length === 0 ? (
            <tr><td className="td text-slate-400" colSpan={5}>No safe history events yet.</td></tr>
          ) : history.map((event, index) => (
            <tr key={`${event.action}-${event.time ?? index}`}>
              <td className="td">{event.action.replace(/_/g, " ")}</td>
              <td className="td">{event.actor}</td>
              <td className="td">{shortDate(event.time)}</td>
              <td className="td">{event.result}</td>
              <td className="td">{event.reason ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

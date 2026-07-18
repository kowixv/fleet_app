import Link from "next/link";
import AmazonImportList from "./components/amazon-import-list";
import { listAmazonImportBatchesForUi } from "@/lib/amazon-statements/server/ui-read-service";

export const dynamic = "force-dynamic";

export default async function AmazonImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; period?: string; review?: string; ready?: string; archived?: string }>;
}) {
  const params = await searchParams;
  const { role, rows } = await listAmazonImportBatchesForUi({
    status: params.status,
    period: params.period,
    needsReview: params.review === "1",
    ready: params.ready === "1",
    archived: params.archived === "1" ? true : params.archived === "0" ? false : undefined,
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <Link href="/settlements" className="text-sm text-brand hover:underline">Back to Settlements</Link>
          <h1 className="mt-1 text-xl font-bold">Amazon Imports</h1>
          <p className="text-sm text-slate-500">Separate Amazon statement workflow. Normal settlements remain unchanged.</p>
        </div>
        {role === "writer" ? <Link href="/settlements/amazon-imports/new" className="btn-primary">New Amazon Import</Link> : null}
      </div>
      {role === "viewer" ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Read-only access. You can inspect import status, but cannot create, upload, parse, or mutate batches.
        </div>
      ) : null}
      <form className="card grid gap-3 md:grid-cols-5">
        <select name="status" className="input" defaultValue={params.status ?? ""}>
          <option value="">All statuses</option>
          {["uploaded", "parsing", "parsed", "needs_review", "reconciled", "ready", "failed", "archived"].map((status) => (
            <option key={status} value={status}>{status.replace(/_/g, " ")}</option>
          ))}
        </select>
        <input name="period" className="input" type="date" defaultValue={params.period ?? ""} aria-label="Period date" />
        <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
          <input name="review" value="1" type="checkbox" defaultChecked={params.review === "1"} />
          Needs review
        </label>
        <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
          <input name="ready" value="1" type="checkbox" defaultChecked={params.ready === "1"} />
          Ready
        </label>
        <button className="btn-primary">Filter</button>
      </form>
      <AmazonImportList rows={rows} />
    </div>
  );
}

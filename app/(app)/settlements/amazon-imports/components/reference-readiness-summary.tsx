import type { AmazonBatchDetailView } from "@/lib/amazon-statements/server/ui-read-service";

export default function ReferenceReadinessSummary({
  readiness,
}: {
  readiness: AmazonBatchDetailView["referenceReadiness"];
}) {
  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-semibold">Reference readiness</h2>
        <p className="text-sm text-slate-500">Read-only aggregate readiness. Reference editing is part of the next workflow slice.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <ReadinessCard title="Revenue" values={readiness.revenue} />
        <ReadinessCard title="Fuel" values={readiness.fuel} />
        <ReadinessCard title="Unique unresolved references" values={readiness.unresolved} />
      </div>
    </section>
  );
}

function ReadinessCard({ title, values }: { title: string; values: Record<string, number> }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <dl className="space-y-1 text-sm">
        {Object.entries(values).map(([key, value]) => (
          <div key={key} className="flex justify-between gap-3">
            <dt className="text-slate-500">{key.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

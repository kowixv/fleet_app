import type { AmazonWorkflowStepView } from "@/lib/amazon-statements/server/ui-read-service";
import AmazonImportStatusBadge from "./amazon-import-status-badge";

export default function AmazonImportStepper({ steps }: { steps: AmazonWorkflowStepView[] }) {
  return (
    <section className="card">
      <h2 className="mb-3 font-semibold">Workflow</h2>
      <ol className="grid gap-3 md:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.key} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500">Step {index + 1}</span>
              <AmazonImportStatusBadge status={step.state} />
            </div>
            <p className="mt-2 font-medium">{step.label}</p>
            <p className="mt-1 text-xs text-slate-500">{step.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

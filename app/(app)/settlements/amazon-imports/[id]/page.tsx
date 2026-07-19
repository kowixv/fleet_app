import Link from "next/link";
import { notFound } from "next/navigation";
import { getAmazonImportBatchDetailForUi } from "@/lib/amazon-statements/server/ui-read-service";
import { requireAmazonImportActor } from "@/lib/amazon-statements/server/auth";
import { previewAmazonProjectionForBatch } from "@/lib/amazon-statements/server/final-workflow-service";
import { projectionPreviewToUi } from "@/lib/amazon-statements/projection/projection-ui";
import AmazonImportStatusBadge from "../components/amazon-import-status-badge";
import AmazonImportStepper from "../components/amazon-import-stepper";
import SourceFileUpload from "../components/source-file-upload";
import UploadedFilesCard from "../components/uploaded-files-card";
import ReconciliationSummary from "../components/reconciliation-summary";
import IssueSummary from "../components/issue-summary";
import ReferenceReadinessSummary from "../components/reference-readiness-summary";
import ProjectionSummary from "../components/projection-summary";
import CandidateSummary from "../components/candidate-summary";
import BatchOperations from "../components/batch-operations";
import HistoryTimeline from "../components/history-timeline";

export const dynamic = "force-dynamic";

const TABS = ["overview", "files", "reconciliation", "issues", "references", "projection", "candidates", "statements", "history"] as const;
type Tab = typeof TABS[number];

export default async function AmazonImportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const activeTab = TABS.includes(query?.tab as Tab) ? query?.tab as Tab : "overview";
  const batch = await getAmazonImportBatchDetailForUi(id);
  if (!batch) notFound();

  const hasBlockingIssues = batch.issues.some((issue) => issue.severity === "blocking" && issue.uniqueRootCount > 0);
  const revenueReconciliationPassed = batch.reconciliation.revenue.status === "passed";
  const hasCanonicalRevenue = Number(batch.reconciliation.revenue.canonicalRevenueItemCount ?? 0) > 0;
  let projection = batch.projection;
  let projectionPreviewUnavailable = false;

  if (!hasBlockingIssues && revenueReconciliationPassed && hasCanonicalRevenue) {
    try {
      const actor = await requireAmazonImportActor();
      const preview = await previewAmazonProjectionForBatch({ actor, batchId: id });
      projection = projectionPreviewToUi(preview);
    } catch {
      projectionPreviewUnavailable = true;
    }
  }

  const projectionBlocked = hasBlockingIssues
    || !revenueReconciliationPassed
    || !hasCanonicalRevenue
    || projectionPreviewUnavailable;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <nav className="flex flex-wrap items-center gap-2 text-sm text-slate-500" aria-label="Breadcrumb">
            <Link href="/settlements" className="text-brand hover:underline">Settlements</Link>
            <span>/</span>
            <Link href="/settlements/amazon-imports" className="text-brand hover:underline">Amazon Imports</Link>
            <span>/</span>
            <span>Current batch</span>
          </nav>
          <h1 className="mt-1 text-xl font-bold">Amazon import batch</h1>
          <p className="text-sm text-slate-500">{batch.period}</p>
          {batch.notes ? <p className="mt-1 text-sm text-slate-600">{batch.notes}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <AmazonImportStatusBadge status={batch.status} />
        </div>
      </div>
      {batch.role === "viewer" ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Read-only access. Upload, parse, projection apply, reference editing, and candidate conversion are unavailable.
        </div>
      ) : null}
      {batch.archived ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          This batch is archived and can only be viewed.
        </div>
      ) : null}
      <AmazonImportStepper steps={batch.workflow} />
      <nav className="card overflow-x-auto p-2" aria-label="Amazon batch workflow tabs">
        <div className="flex min-w-max gap-2" role="tablist">
          {TABS.map((tab) => (
            <Link
              key={tab}
              href={`/settlements/amazon-imports/${batch.id}?tab=${tab}`}
              className={activeTab === tab ? "btn-primary" : "btn-ghost"}
              role="tab"
              aria-selected={activeTab === tab}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </Link>
          ))}
        </div>
      </nav>
      {activeTab === "overview" ? (
        <>
          <BatchOperations batchId={batch.id} status={batch.status} canMutate={batch.canMutate} />
          <ReconciliationSummary revenue={batch.reconciliation.revenue} fuel={batch.reconciliation.fuel} />
          <ReferenceReadinessSummary readiness={batch.referenceReadiness} />
          <ProjectionSummary batchId={batch.id} projection={projection} canMutate={batch.canMutate} blocked={projectionBlocked} />
          <CandidateSummary batchId={batch.id} candidates={batch.candidates} canMutate={batch.canMutate} />
        </>
      ) : null}
      {activeTab === "files" ? <><SourceFileUpload batchId={batch.id} files={batch.files} canMutate={batch.canMutate} canParse={batch.canParse} /><UploadedFilesCard files={batch.files} /></> : null}
      {activeTab === "reconciliation" ? <ReconciliationSummary revenue={batch.reconciliation.revenue} fuel={batch.reconciliation.fuel} /> : null}
      {activeTab === "issues" ? <IssueSummary issues={batch.issues} /> : null}
      {activeTab === "references" ? (
        <>
          <ReferenceReadinessSummary readiness={batch.referenceReadiness} />
          <section className="card space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Reference review</h2>
                <p className="text-sm text-slate-500">Resolve driver, vehicle, facility, fuel-card, and team references without changing financial totals.</p>
              </div>
              <a className="btn-primary text-center" href={`/settlements/amazon-imports/${batch.id}/references`}>
                Open Reference Review
              </a>
            </div>
          </section>
        </>
      ) : null}
      {activeTab === "projection" ? <ProjectionSummary batchId={batch.id} projection={projection} canMutate={batch.canMutate} blocked={projectionBlocked} /> : null}
      {activeTab === "candidates" ? <CandidateSummary batchId={batch.id} candidates={batch.candidates} canMutate={batch.canMutate} /> : null}
      {activeTab === "statements" ? <CandidateSummary batchId={batch.id} candidates={batch.candidates} canMutate={batch.canMutate} /> : null}
      {activeTab === "history" ? <HistoryTimeline history={batch.history} /> : null}
    </div>
  );
}

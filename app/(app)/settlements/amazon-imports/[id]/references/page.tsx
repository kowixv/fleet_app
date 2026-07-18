import { notFound } from "next/navigation";
import { getAmazonReferenceReviewForUi } from "@/lib/amazon-statements/server/reference-review-service";
import ReferenceReviewWorkspace from "../../components/reference-review-workspace";

export const dynamic = "force-dynamic";

export default async function AmazonReferenceReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const review = await getAmazonReferenceReviewForUi(id);
  if (!review) notFound();

  return (
    <main className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <a className="text-sm text-slate-500 hover:text-slate-900" href={`/settlements/amazon-imports/${review.batchId}`}>
            Back to batch
          </a>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Amazon Reference Review</h1>
          <p className="text-sm text-slate-500">
            Batch {review.period} · Status {review.batchStatus}
          </p>
        </div>
        <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          {review.counts.totalRootIssues} root issues · {review.counts.blocking} blocking · {review.counts.warning} warning
        </div>
      </div>

      {review.role === "viewer" ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Viewer access can inspect the queue and history but cannot approve, reject, or archive mappings.
        </div>
      ) : null}

      {review.archived ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          This batch is archived. Reference review is read-only for all normal users.
        </div>
      ) : null}

      <ReferenceReviewWorkspace review={review} />
    </main>
  );
}

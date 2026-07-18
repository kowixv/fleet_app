import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAmazonImportActor } from "@/lib/amazon-statements/server/auth";
import { getAmazonCandidateEditorForUi } from "@/lib/amazon-statements/server/final-workflow-service";
import CandidateEditorWorkspace from "../../../components/candidate-editor-workspace";

export const dynamic = "force-dynamic";

export default async function NewAmazonCandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireAmazonImportActor();
  const view = await getAmazonCandidateEditorForUi({ actor, batchId: id });
  if (!view) notFound();
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-2 text-sm text-slate-500" aria-label="Breadcrumb">
        <Link href="/settlements" className="text-brand hover:underline">Settlements</Link>
        <span>/</span>
        <Link href="/settlements/amazon-imports" className="text-brand hover:underline">Amazon Imports</Link>
        <span>/</span>
        <Link href={`/settlements/amazon-imports/${id}?tab=candidates`} className="text-brand hover:underline">Candidates</Link>
        <span>/</span>
        <span>New</span>
      </nav>
      <h1 className="text-xl font-bold">Create Amazon statement candidate</h1>
      <CandidateEditorWorkspace view={view} />
    </div>
  );
}

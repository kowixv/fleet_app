import Link from "next/link";
import { requireAmazonImportActor } from "@/lib/amazon-statements/server/auth";
import CreateBatchForm from "../components/create-batch-form";

export const dynamic = "force-dynamic";

export default async function NewAmazonImportPage() {
  const actor = await requireAmazonImportActor();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/settlements/amazon-imports" className="text-sm text-brand hover:underline">Back to Amazon Imports</Link>
        <h1 className="mt-1 text-xl font-bold">Create Amazon import batch</h1>
        <p className="text-sm text-slate-500">Create a weekly container before uploading Amazon source files.</p>
      </div>
      <CreateBatchForm canCreate={actor.access === "writer"} />
    </div>
  );
}

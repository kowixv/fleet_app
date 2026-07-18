"use client";

import Link from "next/link";

export default function AmazonImportBatchError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-4">
      <Link href="/settlements/amazon-imports" className="text-sm text-brand hover:underline">Back to Amazon Imports</Link>
      <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        <h1 className="font-semibold">Amazon import could not be loaded.</h1>
        <p className="mt-1">The batch status is unavailable right now. Raw source details and stack traces are intentionally hidden.</p>
        <button type="button" onClick={reset} className="btn-ghost mt-3">Try again</button>
      </div>
    </div>
  );
}

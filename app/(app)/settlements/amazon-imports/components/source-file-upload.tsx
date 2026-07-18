"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseAmazonImportBatchAction, registerAmazonImportFileAction } from "../actions";
import WorkflowActionResult from "./workflow-action-result";

type Slot = {
  sourceType: "amazon_payment" | "amazon_trips" | "fuel_card" | "statement_reference";
  label: string;
  accept: string;
  extension: string;
  maxMb: number;
  optional?: boolean;
};

type UploadFileView = {
  sourceType: Slot["sourceType"];
  sanitizedFilename: string;
  status: string;
};

const SLOTS: Slot[] = [
  { sourceType: "amazon_payment", label: "Amazon Payment", accept: ".xlsx", extension: ".xlsx", maxMb: 10 },
  { sourceType: "amazon_trips", label: "Amazon Trips", accept: ".csv", extension: ".csv", maxMb: 10 },
  { sourceType: "fuel_card", label: "Fuel Card Report", accept: ".pdf", extension: ".pdf", maxMb: 25 },
  { sourceType: "statement_reference", label: "Statement Reference", accept: ".pdf", extension: ".pdf", maxMb: 25, optional: true },
];

export default function SourceFileUpload({
  batchId,
  files,
  canMutate,
  canParse,
}: {
  batchId: string;
  files: UploadFileView[];
  canMutate: boolean;
  canParse: boolean;
}) {
  const router = useRouter();
  const [pendingSource, setPendingSource] = useState<string | null>(null);
  const [pendingParse, startParseTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "ok" | "error" | "info"; text: string } | null>(null);
  const fileBySource = useMemo(() => new Map(files.map((file) => [file.sourceType, file])), [files]);

  async function upload(slot: Slot, file: File | null) {
    setMessage(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(slot.extension)) {
      setMessage({ type: "error", text: `${slot.label} must be a ${slot.extension} file.` });
      return;
    }
    if (file.size > slot.maxMb * 1024 * 1024) {
      setMessage({ type: "error", text: `${slot.label} exceeds the ${slot.maxMb} MB limit.` });
      return;
    }
    const form = new FormData();
    form.set("batchId", batchId);
    form.set("sourceType", slot.sourceType);
    form.set("file", file);
    setPendingSource(slot.sourceType);
    const result = await registerAmazonImportFileAction(form);
    setPendingSource(null);
    if (!result.ok) {
      setMessage({ type: "error", text: result.error.message });
      return;
    }
    setMessage({
      type: result.data.duplicate ? "info" : "ok",
      text: result.data.duplicate ? "This source file is already registered as an active file." : "Upload stored and verified by the server.",
    });
    router.refresh();
  }

  function parseBatch() {
    setMessage(null);
    startParseTransition(async () => {
      const result = await parseAmazonImportBatchAction(batchId);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error.message });
        return;
      }
      setMessage({ type: "ok", text: "Parsing requested. Refreshing workflow status." });
      router.refresh();
    });
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-semibold">Source files</h2>
          <p className="text-sm text-slate-500">Files are verified server-side after storage. Raw storage paths and signatures are never shown.</p>
        </div>
        <button className="btn-primary" type="button" disabled={!canParse || pendingParse} onClick={parseBatch}>
          {pendingParse ? "Parsing..." : "Parse required files"}
        </button>
      </div>
      {!canMutate ? <WorkflowActionResult type="info" message="Read-only access. Viewer users cannot upload or parse files." /> : null}
      {message ? <WorkflowActionResult type={message.type} message={message.text} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {SLOTS.map((slot) => {
          const existing = fileBySource.get(slot.sourceType);
          const pending = pendingSource === slot.sourceType;
          return (
            <div key={slot.sourceType} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{slot.label}{slot.optional ? " (optional)" : ""}</h3>
                  <p className="text-xs text-slate-500">{slot.extension} up to {slot.maxMb} MB</p>
                </div>
                <span className="badge bg-slate-100 text-slate-700">{existing?.status ?? "missing"}</span>
              </div>
              {existing ? (
                <p className="mt-3 text-sm text-slate-700">{existing.sanitizedFilename}</p>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No file registered.</p>
              )}
              {canMutate ? (
                <div className="mt-3">
                  <label className="sr-only" htmlFor={`${slot.sourceType}-file`}>{slot.label} file</label>
                  <input
                    id={`${slot.sourceType}-file`}
                    className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                    type="file"
                    accept={slot.accept}
                    disabled={pending}
                    onChange={(event) => void upload(slot, event.currentTarget.files?.[0] ?? null)}
                  />
                  {pending ? (
                    <div className="mt-3" aria-live="polite">
                      <progress className="h-2 w-full" />
                      <p className="mt-1 text-xs text-slate-500">Uploading and verifying stored bytes...</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

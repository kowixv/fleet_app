"use client";

import { useRef, useState } from "react";

interface UploadResult {
  file: string;
  status: "queued" | "parsing" | "completed" | "duplicate" | "failed";
  invoiceId?: string;
  error?: string;
}

const CONCURRENCY = 2;

export default function BulkMaintenanceInvoiceUpload() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<UploadResult[]>([]);
  const [running, setRunning] = useState(false);

  async function uploadOne(file: File): Promise<UploadResult> {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return { file: file.name, status: "failed", error: "Sadece PDF kabul edilir." };
    }
    const body = new FormData();
    body.append("file", file);
    try {
      const response = await fetch("/api/maintenance/invoices/upload", { method: "POST", body });
      const json = await response.json().catch(() => ({}));
      if (response.ok && json.ok && json.invoiceId) {
        return { file: file.name, status: "completed", invoiceId: json.invoiceId };
      }
      if (response.status === 409 && json.invoiceId) {
        return { file: file.name, status: "duplicate", invoiceId: json.invoiceId, error: json.error };
      }
      return { file: file.name, status: "failed", error: json.error ?? "PDF işlenemedi." };
    } catch (error) {
      return { file: file.name, status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function start(files: FileList | null) {
    const queue = Array.from(files ?? []);
    if (queue.length === 0) return;
    setRunning(true);
    setItems(queue.map((file) => ({ file: file.name, status: "queued" })));

    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const index = cursor;
        cursor += 1;
        setItems((current) => current.map((item, i) => i === index ? { ...item, status: "parsing" } : item));
        const result = await uploadOne(queue[index]);
        setItems((current) => current.map((item, i) => i === index ? result : item));
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));
    setRunning(false);
  }

  const completed = items.filter((item) => item.status === "completed").length;
  const duplicate = items.filter((item) => item.status === "duplicate").length;
  const parsing = items.filter((item) => item.status === "parsing").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const ids = items.filter((item) => item.invoiceId && item.status === "completed").map((item) => item.invoiceId);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Toplu Geçmiş Invoice Yükle</h3>
          <p className="mt-1 text-sm text-slate-500">Birden fazla PDF seçin; her invoice ayrı parse edilip toplu inceleme ekranında gruplanır.</p>
        </div>
        <button type="button" className="btn-ghost" disabled={running} onClick={() => inputRef.current?.click()}>
          Toplu Geçmiş Invoice Yükle
        </button>
      </div>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept="application/pdf,.pdf"
        multiple
        onChange={(event) => start(event.target.files)}
      />

      {items.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 text-sm sm:grid-cols-4">
            <Progress label="Yüklendi" value={`${completed} / ${items.length}`} />
            <Progress label="Parsing" value={String(parsing)} />
            <Progress label="Duplicate" value={String(duplicate)} />
            <Progress label="Hatalı" value={String(failed)} />
          </div>
          {ids.length > 0 && !running && (
            <a className="btn-primary inline-flex" href={`/maintenance/invoices/bulk?ids=${ids.join(",")}`}>
              Toplu incelemeye geç
            </a>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-brand">Detay</summary>
            <div className="mt-2 space-y-1">
              {items.map((item) => (
                <p key={item.file} className={item.status === "failed" ? "text-red-600" : "text-slate-600"}>
                  {item.file}: {item.status}{item.error ? ` - ${item.error}` : ""}
                </p>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function Progress({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

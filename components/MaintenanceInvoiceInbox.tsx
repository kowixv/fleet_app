"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import {
  cancelMaintenanceInvoiceReview,
  retryMaintenanceInvoiceProcessing,
  undoMaintenanceInvoiceImport,
} from "@/app/(app)/maintenance/invoice-actions";
import type { MaintenanceInvoicePipelineStatus } from "@/lib/maintenance/domain";
import {
  DEFAULT_MAINTENANCE_INVOICE_MAX_BYTES,
  parseMaintenanceInvoiceUploadResponse,
  validateMaintenanceInvoiceFileMeta,
} from "@/lib/maintenance-invoice-upload";
import {
  MAINTENANCE_INVOICE_PIPELINE_LABELS,
  maintenanceInvoicePipelineTone,
} from "@/lib/maintenance/presentation";

export interface MaintenanceInvoiceInboxRow {
  id: string;
  file_name: string;
  invoice_number: string | null;
  invoice_date: string | null;
  shop_name: string | null;
  status: "pending_review" | "completed" | "failed" | "cancelled";
  pipeline_status: MaintenanceInvoicePipelineStatus;
  retry_count: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  parser_warnings: string[] | null;
  parsed_data: { review?: { services?: unknown[] } } | null;
  vehicles: { unit_number: string } | Array<{ unit_number: string }> | null;
}

export default function MaintenanceInvoiceInbox({ rows }: { rows: MaintenanceInvoiceInboxRow[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ id: string; action: "cancel" | "undo" } | null>(null);

  function upload(file: File | null | undefined) {
    if (!file) return;
    const fileError = validateMaintenanceInvoiceFileMeta(file, DEFAULT_MAINTENANCE_INVOICE_MAX_BYTES);
    if (fileError) {
      setMessage({ type: "error", text: fileError });
      return;
    }
    const form = new FormData();
    form.append("file", file);
    setProgress(0);
    setMessage(null);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/maintenance/invoices/upload");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      setProgress(null);
      const body = parseMaintenanceInvoiceUploadResponse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300 && body.invoiceId) {
        setMessage({ type: "ok", text: "PDF yüklendi ve işleme sırasına alındı." });
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } else {
        setMessage({ type: "error", text: body.error ?? `PDF işlenemedi (HTTP ${xhr.status}).` });
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      setMessage({ type: "error", text: "Yükleme başarısız oldu." });
    };
    xhr.send(form);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    upload(event.dataTransfer.files[0]);
  }

  async function cancel(id: string) {
    setBusyId(id);
    const result = await cancelMaintenanceInvoiceReview(id);
    setBusyId(null);
    setConfirmAction(null);
    if (!result.ok) setMessage({ type: "error", text: result.error });
    else router.refresh();
  }

  async function undo(id: string) {
    setBusyId(id);
    const result = await undoMaintenanceInvoiceImport(id);
    setBusyId(null);
    setConfirmAction(null);
    if (!result.ok) setMessage({ type: "error", text: result.error });
    else router.refresh();
  }

  async function retry(id: string) {
    setBusyId(id);
    const result = await retryMaintenanceInvoiceProcessing(id);
    setBusyId(null);
    if (!result.ok) setMessage({ type: "error", text: result.error });
    else router.refresh();
  }

  const sorted = [...rows].sort(
    (left, right) =>
      (left.pipeline_status === "pending_review" ? -1 : 0)
      - (right.pipeline_status === "pending_review" ? -1 : 0),
  );

  return (
    <section className="space-y-4">
      <div
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`card border-2 border-dashed ${dragging ? "border-brand bg-brand/5" : "border-slate-200"}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Invoice İnceleme Inbox</h2>
            <p className="mt-1 text-sm text-slate-500">
              PDF sıraya alınır; bakım kayıtları yalnızca insan incelemesi ve son onaydan sonra yazılır.
            </p>
          </div>
          <button type="button" className="btn-primary" disabled={progress != null} onClick={() => inputRef.current?.click()}>
            PDF Seç
          </button>
        </div>
        <input ref={inputRef} className="hidden" type="file" accept="application/pdf,.pdf" onChange={(event) => upload(event.target.files?.[0])} />
        {progress != null && (
          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded bg-slate-100">
              <div className="h-full bg-brand" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500">Yükleniyor: %{progress}</p>
          </div>
        )}
        {message && (
          <p className={`mt-3 rounded-lg border px-3 py-2 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
            {message.text}
          </p>
        )}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Vendor</th><th className="th">Invoice tarihi</th><th className="th">Araç</th>
              <th className="th">Servis sayısı</th><th className="th">Pipeline</th><th className="th text-right">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.length === 0 ? (
              <tr><td className="td text-slate-400" colSpan={6}>Invoice kaydı yok.</td></tr>
            ) : sorted.map((row) => (
              <tr key={row.id} className={row.pipeline_status === "pending_review" ? "bg-amber-50/40" : ""}>
                <td className="td">{row.shop_name ?? row.file_name}</td>
                <td className="td">{row.invoice_date ?? "-"}</td>
                <td className="td">{Array.isArray(row.vehicles) ? row.vehicles[0]?.unit_number ?? "-" : row.vehicles?.unit_number ?? "-"}</td>
                <td className="td">{row.parsed_data?.review?.services?.length ?? 0}</td>
                <td className="td">
                  <span className={`badge ${maintenanceInvoicePipelineTone(row.pipeline_status)}`}>
                    {MAINTENANCE_INVOICE_PIPELINE_LABELS[row.pipeline_status]}
                  </span>
                  {row.retry_count > 0 && <div className="mt-1 text-xs text-slate-500">Deneme {row.retry_count}</div>}
                  {row.last_error && <div className="mt-1 max-w-xs text-xs text-red-600" title={row.last_error}>{row.last_error}</div>}
                  {row.next_attempt_at && row.pipeline_status === "queued" && (
                    <div className="mt-1 text-xs text-slate-500">Tekrar: {new Date(row.next_attempt_at).toLocaleString("tr-TR")}</div>
                  )}
                </td>
                <td className="td text-right">
                  <Link className="mr-3 text-brand hover:underline" href={`/api/maintenance/invoices/${row.id}`} target="_blank">PDF</Link>
                  {row.pipeline_status === "pending_review" || row.pipeline_status === "completed" ? (
                    <Link className="mr-3 text-brand hover:underline" href={`/maintenance/invoices/${row.id}`}>İncele</Link>
                  ) : null}
                  {row.pipeline_status === "failed" && (
                    <button
                      disabled={busyId === row.id}
                      type="button"
                      className="mr-3 text-brand hover:underline disabled:opacity-50"
                      onClick={() => retry(row.id)}
                    >
                      Tekrar dene
                    </button>
                  )}
                  {row.pipeline_status === "pending_review" && (
                    confirmAction?.id === row.id && confirmAction.action === "cancel" ? (
                      <ConfirmButtons busy={busyId === row.id} onConfirm={() => cancel(row.id)} onCancel={() => setConfirmAction(null)} />
                    ) : (
                      <button disabled={busyId === row.id} type="button" className="mr-3 text-red-600 hover:underline" onClick={() => setConfirmAction({ id: row.id, action: "cancel" })}>İptal</button>
                    )
                  )}
                  {row.pipeline_status === "completed" && (
                    confirmAction?.id === row.id && confirmAction.action === "undo" ? (
                      <ConfirmButtons busy={busyId === row.id} onConfirm={() => undo(row.id)} onCancel={() => setConfirmAction(null)} />
                    ) : (
                      <button disabled={busyId === row.id} type="button" className="text-red-600 hover:underline" onClick={() => setConfirmAction({ id: row.id, action: "undo" })}>Geri al</button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ConfirmButtons({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <span className="mr-3 inline-flex items-center gap-2">
      <button disabled={busy} type="button" className="text-red-600 hover:underline" onClick={onConfirm}>Onayla</button>
      <button disabled={busy} type="button" className="text-slate-500 hover:underline" onClick={onCancel}>Vazgeç</button>
    </span>
  );
}

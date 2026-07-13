"use client";

import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { cancelMaintenanceInvoiceReview, undoMaintenanceInvoiceImport } from "@/app/(app)/maintenance/invoice-actions";

export interface MaintenanceInvoiceInboxRow {
  id: string;
  file_name: string;
  invoice_number: string | null;
  invoice_date: string | null;
  shop_name: string | null;
  status: "pending_review" | "completed" | "duplicate" | "failed" | "cancelled";
  parser_warnings: string[] | null;
  parsed_data: { review?: { services?: unknown[] } } | null;
  vehicles: { unit_number: string } | null;
}

export default function MaintenanceInvoiceInbox({ rows }: { rows: MaintenanceInvoiceInboxRow[] }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function upload(file: File | null | undefined) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setMessage({ type: "error", text: "Sadece PDF yükleyin." });
      return;
    }
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/maintenance/invoices/upload");
    setProgress(0);
    setMessage(null);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      setProgress(null);
      let body: { ok?: boolean; invoiceId?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.ok && body.invoiceId) {
        setMessage({ type: "ok", text: "Taslak oluşturuldu. İnceleme ekranı açılıyor." });
        window.location.href = `/maintenance/invoices/${body.invoiceId}`;
      } else {
        setMessage({ type: "error", text: body.error ?? "PDF işlenemedi." });
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
    if (!window.confirm("Bu taslak iptal edilsin mi?")) return;
    setBusyId(id);
    const result = await cancelMaintenanceInvoiceReview(id);
    setBusyId(null);
    if (!result.ok) setMessage({ type: "error", text: result.error });
  }

  async function undo(id: string) {
    if (!window.confirm("Bu tamamlanmış import geri alınsın mı? Sadece bu invoice ile oluşturulan kayıtlar etkilenir.")) return;
    setBusyId(id);
    const result = await undoMaintenanceInvoiceImport(id);
    setBusyId(null);
    if (!result.ok) setMessage({ type: "error", text: result.error });
  }

  const sorted = [...rows].sort((a, b) => (a.status === "pending_review" ? -1 : 0) - (b.status === "pending_review" ? -1 : 0));

  return (
    <section className="space-y-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`card border-2 border-dashed ${dragging ? "border-brand bg-brand/5" : "border-slate-200"}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Maintenance Invoice Review Inbox</h2>
            <p className="mt-1 text-sm text-slate-500">PDF yükleyin; kayıtlar ancak inceleme ve son onaydan sonra yazılır.</p>
          </div>
          <button type="button" className="btn-primary" onClick={() => inputRef.current?.click()}>
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
              <th className="th">Vendor</th>
              <th className="th">Invoice Date</th>
              <th className="th">Unit</th>
              <th className="th">Service Count</th>
              <th className="th">Status</th>
              <th className="th text-right">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.length === 0 ? (
              <tr><td className="td text-slate-400" colSpan={6}>Invoice taslağı yok.</td></tr>
            ) : sorted.map((row) => (
              <tr key={row.id} className={row.status === "pending_review" ? "bg-amber-50/40" : ""}>
                <td className="td">{row.shop_name ?? row.file_name}</td>
                <td className="td">{row.invoice_date ?? "—"}</td>
                <td className="td">{row.vehicles?.unit_number ?? "—"}</td>
                <td className="td">{row.parsed_data?.review?.services?.length ?? 0}</td>
                <td className="td"><span className="badge bg-slate-100 text-slate-700">{row.status}</span></td>
                <td className="td text-right">
                  <Link className="mr-3 text-brand hover:underline" href={`/api/maintenance/invoices/${row.id}`} target="_blank">PDF</Link>
                  <Link className="mr-3 text-brand hover:underline" href={`/maintenance/invoices/${row.id}`}>İncele</Link>
                  {row.status === "pending_review" && (
                    <button disabled={busyId === row.id} type="button" className="mr-3 text-red-600 hover:underline" onClick={() => cancel(row.id)}>İptal</button>
                  )}
                  {row.status === "completed" && (
                    <button disabled={busyId === row.id} type="button" className="text-red-600 hover:underline" onClick={() => undo(row.id)}>Undo</button>
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

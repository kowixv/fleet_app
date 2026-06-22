"use client";

import { useState, useTransition } from "react";
import { approveImported, rejectImported, updateImported } from "@/app/(app)/imported/actions";
import { usd } from "@/lib/format";

type Imp = Record<string, any>;

const FIELDS: { name: string; label: string; type?: string }[] = [
  { name: "load_number", label: "Load #" },
  { name: "broker_name", label: "Broker" },
  { name: "pickup_date", label: "Pickup", type: "date" },
  { name: "pickup_location", label: "Pickup Yeri" },
  { name: "delivery_date", label: "Teslim", type: "date" },
  { name: "delivery_location", label: "Teslim Yeri" },
  { name: "total_miles", label: "Mil", type: "number" },
  { name: "gross_rate", label: "Tutar", type: "number" },
];

function Card({ imp }: { imp: Imp }) {
  const [edit, setEdit] = useState(false);
  const [pending, start] = useTransition();
  const [vals, setVals] = useState<Imp>(imp);

  function save() {
    start(async () => {
      await updateImported(imp.id, vals);
      setEdit(false);
    });
  }

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {imp.source_type?.toUpperCase()} · {new Date(imp.created_at).toLocaleString("tr-TR")}
        </span>
        {imp.file_url ? (
          <a
            href={`/api/imports/file?path=${encodeURIComponent(imp.file_url)}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-brand hover:underline"
          >
            Dosyayı aç
          </a>
        ) : null}
      </div>

      {edit ? (
        <div className="grid grid-cols-2 gap-2">
          {FIELDS.map((f) => (
            <div key={f.name}>
              <label className="label">{f.label}</label>
              <input
                type={f.type ?? "text"}
                step={f.type === "number" ? "0.01" : undefined}
                value={vals[f.name] ?? ""}
                onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}
                className="input"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <Field label="Load #" value={imp.load_number} />
          <Field label="Broker" value={imp.broker_name} />
          <Field label="Güzergah" value={`${imp.pickup_location ?? "?"} → ${imp.delivery_location ?? "?"}`} />
          <Field label="Mil" value={imp.total_miles} />
          <Field label="Tutar" value={imp.gross_rate != null ? usd(imp.gross_rate) : null} />
          <Field label="Teslim" value={imp.delivery_date} />
        </div>
      )}

      {imp.raw_text ? (
        <p className="mt-2 line-clamp-2 text-xs text-slate-400">{imp.raw_text}</p>
      ) : null}

      <div className="mt-3 flex gap-2">
        {edit ? (
          <>
            <button onClick={save} disabled={pending} className="btn-primary text-sm">Kaydet</button>
            <button onClick={() => setEdit(false)} className="btn-ghost text-sm">İptal</button>
          </>
        ) : (
          <>
            <button
              onClick={() => start(async () => void (await approveImported(imp.id)))}
              disabled={pending}
              className="btn-primary text-sm"
            >
              ✅ Onayla → Load
            </button>
            <button onClick={() => setEdit(true)} className="btn-ghost text-sm">Düzenle</button>
            <button
              onClick={() => start(async () => void (await rejectImported(imp.id)))}
              disabled={pending}
              className="btn-ghost text-sm text-red-600"
            >
              ❌ Reddet
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <span className="text-slate-400">{label}: </span>
      <span className="font-medium">{value || "—"}</span>
    </div>
  );
}

export default function ImportedInbox({ rows }: { rows: Imp[] }) {
  if (rows.length === 0)
    return <p className="text-slate-400">Bekleyen yük yok. Telegram gruplarından gelen yükler burada listelenir.</p>;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {rows.map((r) => (
        <Card key={r.id} imp={r} />
      ))}
    </div>
  );
}

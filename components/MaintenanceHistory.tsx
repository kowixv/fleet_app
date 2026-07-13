import { usd } from "@/lib/format";

export interface MaintenanceHistoryRow {
  id: string;
  service_type: string | null;
  part_name: string | null;
  parts_used: string[] | null;
  performed_date: string | null;
  mileage: number | null;
  cost: number | null;
  shop_name: string | null;
  next_due_mileage: number | null;
  next_due_date: string | null;
  notes: string | null;
  source: string;
  invoice_id: string | null;
  vehicles: { unit_number: string } | null;
  maintenance_invoices: { file_name: string; invoice_number: string | null } | null;
}

export default function MaintenanceHistory({
  rows,
  repairWarningAmount,
}: {
  rows: MaintenanceHistoryRow[];
  repairWarningAmount: number;
}) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="th">Tarih</th>
            <th className="th">Unit</th>
            <th className="th">Servis / Parça</th>
            <th className="th">Mileage</th>
            <th className="th">Sonraki</th>
            <th className="th">Shop</th>
            <th className="th">Maliyet</th>
            <th className="th">Invoice</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td className="td text-slate-400" colSpan={8}>Henüz bakım geçmişi yok.</td>
            </tr>
          ) : (
            rows.map((row) => {
              const cost = Number(row.cost ?? 0);
              const expensive = repairWarningAmount > 0 && cost >= repairWarningAmount;
              return (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="td whitespace-nowrap">{row.performed_date ?? "—"}</td>
                  <td className="td font-medium">{row.vehicles?.unit_number ?? "—"}</td>
                  <td className="td">
                    <div>{row.service_type ?? "—"}</div>
                    {row.part_name && <div className="text-xs text-slate-500">{row.part_name}</div>}
                    {row.parts_used?.length ? <div className="text-xs text-slate-500">Parts: {row.parts_used.join(", ")}</div> : null}
                    {row.notes && <div className="max-w-xs truncate text-xs text-slate-400" title={row.notes}>{row.notes}</div>}
                  </td>
                  <td className="td">{row.mileage == null ? "—" : `${Number(row.mileage).toLocaleString("en-US")} mi`}</td>
                  <td className="td">
                    {row.next_due_mileage != null
                      ? `${Number(row.next_due_mileage).toLocaleString("en-US")} mi`
                      : row.next_due_date ?? "—"}
                  </td>
                  <td className="td">{row.shop_name ?? "—"}</td>
                  <td className="td">
                    <span className={expensive ? "font-semibold text-red-700" : ""}>{usd(cost)}</span>
                    {expensive && <span className="ml-2 badge bg-red-100 text-red-700">Yüksek</span>}
                  </td>
                  <td className="td">
                    {row.invoice_id ? (
                      <a className="text-brand hover:underline" href={`/api/maintenance/invoices/${row.invoice_id}`} target="_blank" rel="noreferrer">
                        {row.maintenance_invoices?.invoice_number || row.maintenance_invoices?.file_name || "PDF"}
                      </a>
                    ) : (
                      <span className="text-slate-400">{row.source === "manual" ? "Manuel" : "—"}</span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { createSettlementFromSelection, previewSettlement } from "@/app/(app)/settlements/actions";
import { useMemo, useState, useTransition } from "react";

type Opt = { value: string; label: string };
type Preview = Record<string, any>;

function usd(value: unknown) {
  const n = Number(value) || 0;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function percentValue(value: unknown) {
  if (value == null) return "-";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

export default function SettlementForm({
  vehicles,
  drivers,
  owners,
  companies,
  carriers,
}: {
  vehicles: Opt[];
  drivers: Opt[];
  owners: Opt[];
  companies: Opt[];
  carriers: Opt[];
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("owner_operator");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedLoads, setSelectedLoads] = useState<Set<string>>(new Set());
  const [selectedExpenses, setSelectedExpenses] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const isExternal = type === "external_carrier_statement";
  const isInvestor = type === "managed_investor";
  const isDriver = type === "company_driver" || type === "box_truck_driver";

  const payload = useMemo(() => {
    return (formData: FormData) => ({
      settlement_type: String(formData.get("settlement_type") || type),
      vehicle_id: String(formData.get("vehicle_id") || ""),
      driver_id: String(formData.get("driver_id") || ""),
      owner_id: String(formData.get("owner_id") || ""),
      company_id: String(formData.get("company_id") || ""),
      external_carrier_id: String(formData.get("external_carrier_id") || ""),
      week_start: String(formData.get("week_start") || ""),
      week_end: String(formData.get("week_end") || ""),
      external_net_pay: String(formData.get("external_net_pay") || ""),
      ov_driver_pct: String(formData.get("ov_driver_pct") || ""),
      ov_company_pct: String(formData.get("ov_company_pct") || ""),
      ov_commission: String(formData.get("ov_commission") || ""),
    });
  }, [type]);

  function toggle(setter: (next: Set<string>) => void, current: Set<string>, id: string) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  function onPreview(formData: FormData) {
    setError("");
    startTransition(async () => {
      const result = await previewSettlement(payload(formData));
      if (!result.ok) {
        setError(result.error);
        setPreview(null);
        return;
      }
      setPreview(result.preview);
      setSelectedLoads(new Set(result.preview.selectedLoadIds));
      setSelectedExpenses(new Set(result.preview.selectedExpenseIds));
    });
  }

  function onCreate(formData: FormData) {
    setError("");
    startTransition(async () => {
      const result = await createSettlementFromSelection({
        ...payload(formData),
        selected_load_ids: [...selectedLoads],
        selected_expense_ids: [...selectedExpenses],
        preview_revision: preview?.revision ?? null,
      });
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">New Settlement</h2>
          <p className="text-xs text-slate-500">Preview eligible rows, select items, then create a Draft.</p>
        </div>
        <button type="button" onClick={() => setOpen((value) => !value)} className="btn-primary">
          {open ? "Close" : "+ New"}
        </button>
      </div>

      {open && (
        <form className="mt-4 space-y-5">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <span className="rounded bg-brand px-2 py-0.5 text-white">1</span>
              Settlement Information
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="label">Settlement Type</label>
                <select name="settlement_type" value={type} onChange={(event) => { setType(event.target.value); setPreview(null); }} className="input">
                  <option value="company_driver">Company Driver</option>
                  <option value="box_truck_driver">Box Truck Driver</option>
                  <option value="owner_operator">Owner Operator</option>
                  <option value="managed_investor">Managed Investor</option>
                  <option value="external_carrier_statement">External Carrier Statement</option>
                </select>
              </div>
              {!isExternal && (
                <div>
                  <label className="label">Vehicle / Unit</label>
                  <select name="vehicle_id" className="input">
                    <option value="">-</option>
                    {vehicles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              )}
              {isDriver && (
                <div>
                  <label className="label">Driver</label>
                  <select name="driver_id" className="input">
                    <option value="">-</option>
                    {drivers.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              )}
              {(isInvestor || type === "owner_operator") && (
                <div>
                  <label className="label">Owner / Investor</label>
                  <select name="owner_id" className="input">
                    <option value="">-</option>
                    {owners.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label">Company</label>
                <select name="company_id" className="input">
                  <option value="">-</option>
                  {companies.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              {isExternal && (
                <>
                  <div>
                    <label className="label">External Carrier</label>
                    <select name="external_carrier_id" className="input">
                      <option value="">-</option>
                      {carriers.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">External Net Pay</label>
                    <input name="external_net_pay" type="number" min="0" step="0.01" className="input" />
                  </div>
                </>
              )}
              {!isExternal && (
                <>
                  <div>
                    <label className="label">Week Start</label>
                    <input name="week_start" type="date" className="input" />
                  </div>
                  <div>
                    <label className="label">Week End</label>
                    <input name="week_end" type="date" className="input" />
                  </div>
                </>
              )}
            </div>
            <div className="grid gap-3 border-t border-slate-100 pt-3 md:grid-cols-3">
              <div>
                <label className="label">Driver % Override</label>
                <input name="ov_driver_pct" type="number" min="0" max="100" step="0.01" className="input" />
              </div>
              <div>
                <label className="label">Company Fee % Override</label>
                <input name="ov_company_pct" type="number" min="0" max="100" step="0.01" className="input" />
              </div>
              <div>
                <label className="label">Commission Override</label>
                <input name="ov_commission" type="number" min="0" step="0.01" className="input" />
              </div>
            </div>
            <button type="submit" formAction={onPreview} className="btn-primary" disabled={pending}>
              {pending ? "Previewing..." : "Preview Eligible Items"}
            </button>
          </section>

          {preview && (
            <>
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <span className="rounded bg-brand px-2 py-0.5 text-white">2</span>
                  Loads and Expenses
                </div>
                <SelectableTable
                  title="Eligible Loads"
                  rows={preview.availableLoads}
                  selected={selectedLoads}
                  onToggle={(id) => toggle(setSelectedLoads, selectedLoads, id)}
                  columns={(row) => [row.load_number ?? "-", row.route || `${row.pickup_location ?? ""} -> ${row.delivery_location ?? ""}`, row.delivery_date ?? "-", row.status ?? "-", usd(row.gross_amount)]}
                />
                <SelectableTable
                  title="Eligible Expenses"
                  rows={preview.availableExpenses}
                  selected={selectedExpenses}
                  onToggle={(id) => toggle(setSelectedExpenses, selectedExpenses, id)}
                  columns={(row) => [row.date ?? "-", row.category ?? "-", row.notes ?? "-", row.targeting_reason ?? "Universal", usd(row.amount)]}
                />
                {(preview.unavailableLoads.length > 0 || preview.unavailableExpenses.length > 0) && (
                  <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    Unavailable rows: {preview.unavailableLoads.length + preview.unavailableExpenses.length}. Reasons include wrong status, wrong targeting, invalid gross, or already used in this lane.
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <span className="rounded bg-brand px-2 py-0.5 text-white">3</span>
                  Calculation Preview
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <Stat label="Fleet Gross" value={usd(preview.result.grossRevenue)} />
                  <Stat label={preview.result.calculationBaseLabel} value={usd(preview.result.calculationBaseAmount)} />
                  <Stat label="Deductions" value={usd(preview.result.totalDeductions)} />
                  <Stat label={preview.result.payableLabel} value={usd(preview.result.netPay)} strong />
                </div>
                <div className="grid gap-2 text-xs text-slate-600 md:grid-cols-3">
                  <span>Driver Pay: {percentValue(preview.config.driverPayPct)} ({preview.configSnapshot.sources.driver_pay_pct})</span>
                  <span>Company Fee: {percentValue(preview.config.companyFeePct)} ({preview.configSnapshot.sources.company_fee_pct})</span>
                  <span>Commission: {String(preview.config.managementCommission.type)} {String(preview.config.managementCommission.amount)} ({preview.configSnapshot.sources.management_commission_amount})</span>
                </div>
                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="w-full">
                    <tbody className="divide-y divide-slate-100">
                      {preview.result.calculationRows.map((row: any) => (
                        <tr key={row.key}>
                          <td className="td">{row.labelEn}</td>
                          <td className="td text-right">{usd(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="flex items-center justify-between border-t border-slate-100 pt-4">
                <div className="text-xs text-slate-500">Create writes a Draft after the server refetches and recomputes this selection.</div>
                <button type="submit" formAction={onCreate} className="btn-primary" disabled={pending}>
                  {pending ? "Creating..." : "Create Draft"}
                </button>
              </section>
            </>
          )}

          {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </form>
      )}
    </div>
  );
}

function SelectableTable({
  title,
  rows,
  selected,
  onToggle,
  columns,
}: {
  title: string;
  rows: any[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  columns: (row: any) => string[];
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title} ({rows.length})</h3>
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full">
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td className="td text-slate-400">No eligible rows.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id}>
                <td className="td w-10">
                  <input type="checkbox" checked={selected.has(row.id)} onChange={() => onToggle(row.id)} />
                </td>
                {columns(row).map((value, index) => <td key={index} className="td">{value}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded border border-slate-200 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 font-bold ${strong ? "text-xl text-brand" : "text-lg"}`}>{value}</p>
    </div>
  );
}

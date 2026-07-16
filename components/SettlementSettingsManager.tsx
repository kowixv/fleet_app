"use client";

import { saveVehicleSettlementConfig } from "@/app/(app)/settlements/actions";
import { useState, useTransition } from "react";

type Opt = { value: string; label: string };

function percent(value: number | null) {
  return value == null ? "" : String(Math.round(Number(value) * 10000) / 100);
}

function numberValue(value: number | null) {
  return value == null ? "" : String(value);
}

export default function SettlementSettingsManager({
  vehicles,
  companies,
  owners,
  carriers,
}: {
  vehicles: any[];
  companies: Opt[];
  owners: Opt[];
  carriers: Opt[];
}) {
  const [editing, setEditing] = useState<any | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError("");
    startTransition(async () => {
      const result = await saveVehicleSettlementConfig(Object.fromEntries(formData.entries()));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Unit</th>
              <th className="th">Model</th>
              <th className="th">Company</th>
              <th className="th">Owner / Investor</th>
              <th className="th text-right">Driver %</th>
              <th className="th text-right">Company Fee</th>
              <th className="th text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vehicles.map((vehicle) => (
              <tr key={vehicle.id} className="hover:bg-slate-50">
                <td className="td font-medium">{vehicle.unit_number}</td>
                <td className="td">{vehicle.ownership_type}</td>
                <td className="td">{companies.find((company) => company.value === vehicle.company_id)?.label ?? "-"}</td>
                <td className="td">{owners.find((owner) => owner.value === vehicle.owner_id)?.label ?? "-"}</td>
                <td className="td text-right">{percent(vehicle.default_driver_pay_pct) || "missing"}</td>
                <td className="td text-right">{percent(vehicle.company_fee_pct) || "0"}</td>
                <td className="td text-right">
                  <button onClick={() => setEditing(vehicle)} className="btn-ghost text-sm">Configure</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
          <div className="card my-8 w-full max-w-4xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Settlement Defaults - Unit {editing.unit_number}</h2>
              <button onClick={() => setEditing(null)} className="text-slate-400">X</button>
            </div>
            <form action={onSubmit} className="space-y-4">
              <input type="hidden" name="vehicle_id" value={editing.id} />
              <div className="grid gap-3 md:grid-cols-3">
                <Select name="ownership_type" label="Default payment model" defaultValue={editing.ownership_type}>
                  <option value="company_owned">Company Owned</option>
                  <option value="owner_operator">Owner Operator</option>
                  <option value="investor_managed">Investor Managed</option>
                  <option value="external_carrier_statement">External Carrier Statement</option>
                  <option value="partner_carrier">Partner Carrier</option>
                </Select>
                <OptionSelect name="company_id" label="Company" options={companies} defaultValue={editing.company_id} />
                <OptionSelect name="owner_id" label="Owner / Investor" options={owners} defaultValue={editing.owner_id} />
                <OptionSelect name="external_carrier_id" label="External Carrier" options={carriers} defaultValue={editing.external_carrier_id} />
                <Field name="default_driver_pay_pct" label="Default Driver Pay %" defaultValue={percent(editing.default_driver_pay_pct)} />
                <Field name="company_fee_pct" label="Company Fee %" defaultValue={percent(editing.company_fee_pct)} />
                <Field name="external_carrier_fee_pct" label="External Carrier Fee %" defaultValue={percent(editing.external_carrier_fee_pct)} />
                <Select name="management_commission_type" label="Management Commission Type" defaultValue={editing.management_commission_type ?? "none"}>
                  <option value="none">None</option>
                  <option value="flat">Flat</option>
                  <option value="percent">Percent</option>
                </Select>
                <Field name="management_commission_amount" label="Management Commission Amount" defaultValue={numberValue(editing.management_commission_amount)} />
                <label className="mt-6 flex items-center gap-2 text-sm">
                  <input name="company_fee_is_our_revenue" type="checkbox" defaultChecked={editing.company_fee_is_our_revenue ?? true} />
                  Company fee is our revenue
                </label>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} className="btn-ghost">Cancel</button>
                <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving..." : "Save Defaults"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ name, label, defaultValue }: { name: string; label: string; defaultValue: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input name={name} type="number" min="0" max={label.includes("%") ? "100" : undefined} step="0.01" className="input" defaultValue={defaultValue} />
    </div>
  );
}

function Select({ name, label, defaultValue, children }: { name: string; label: string; defaultValue: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select name={name} className="input" defaultValue={defaultValue}>{children}</select>
    </div>
  );
}

function OptionSelect({ name, label, options, defaultValue }: { name: string; label: string; options: Opt[]; defaultValue?: string | null }) {
  return (
    <Select name={name} label={label} defaultValue={defaultValue ?? ""}>
      <option value="">-</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </Select>
  );
}

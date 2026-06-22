"use client";

import { useState } from "react";
import { createSettlement } from "@/app/(app)/settlements/actions";

type Opt = { value: string; label: string };

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
  const [type, setType] = useState("owner_operator");
  const [open, setOpen] = useState(false);
  const isExternal = type === "external_carrier_statement";
  const isInvestor = type === "managed_investor";

  return (
    <div className="card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="mb-1 flex w-full items-center justify-between text-left font-semibold"
      >
        <span>+ Yeni Settlement Oluştur</span>
        <span className="text-slate-400">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <form action={createSettlement} className="mt-4 grid grid-cols-3 gap-3">
          <div>
            <label className="label">Settlement Tipi</label>
            <select
              name="settlement_type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="input"
            >
              <option value="company_driver">Company Driver</option>
              <option value="box_truck_driver">Box Truck Driver</option>
              <option value="owner_operator">Owner Operator</option>
              <option value="managed_investor">Managed / Investor</option>
              <option value="external_carrier_statement">External Carrier Statement</option>
            </select>
          </div>
          <div>
            <label className="label">Araç / Unit</label>
            <select name="vehicle_id" className="input">
              <option value="">—</option>
              {vehicles.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Şoför</label>
            <select name="driver_id" className="input">
              <option value="">—</option>
              {drivers.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {(isInvestor || type === "owner_operator") && (
            <div>
              <label className="label">Owner / Investor</label>
              <select name="owner_id" className="input">
                <option value="">—</option>
                {owners.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Şirket</label>
            <select name="company_id" className="input">
              <option value="">—</option>
              {companies.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {isExternal && (
            <div>
              <label className="label">External Carrier</label>
              <select name="external_carrier_id" className="input">
                <option value="">—</option>
                {carriers.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}

          {!isExternal && (
            <>
              <div>
                <label className="label">Hafta Başı</label>
                <input name="week_start" type="date" className="input" />
              </div>
              <div>
                <label className="label">Hafta Sonu</label>
                <input name="week_end" type="date" className="input" />
              </div>
            </>
          )}
          {isExternal && (
            <div>
              <label className="label">External Net Pay ($)</label>
              <input name="external_net_pay" type="number" step="0.01" className="input" />
            </div>
          )}

          <div className="col-span-3 mt-1 border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-medium text-slate-500">
              Override (boş bırakılırsa araç/şoför varsayılanı kullanılır)
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Driver % override</label>
                <input name="ov_driver_pct" type="number" step="0.1" placeholder="33" className="input" />
              </div>
              <div>
                <label className="label">Company Fee % override</label>
                <input name="ov_company_pct" type="number" step="0.1" placeholder="12" className="input" />
              </div>
              <div>
                <label className="label">Komisyon $ override</label>
                <input name="ov_commission" type="number" step="0.01" placeholder="250" className="input" />
              </div>
            </div>
          </div>

          <div className="col-span-3 flex justify-end">
            <button type="submit" className="btn-primary">Hesapla &amp; Kaydet</button>
          </div>
        </form>
      )}
    </div>
  );
}

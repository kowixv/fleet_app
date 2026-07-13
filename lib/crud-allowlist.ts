/**
 * Write allowlist for the generic CRUD server actions. Kept in its own (non
 * "use server") module so the pure logic can be unit-tested and imported without
 * Next.js requiring every export to be an async server action.
 *
 * Security: only tables present here are writable, and only the listed columns are
 * persisted. `organization_id` is never in any list — it is injected from the session
 * in `lib/crud.ts`, never accepted from the client.
 */
export const ALLOWED: Record<string, string[]> = {
  companies: ["name", "scac", "mc_number", "usdot_number", "notes"],
  external_carriers: ["name", "default_commission", "notes"],
  people: [
    "full_name", "type", "phone", "email", "default_pay_pct",
    "default_insurance_deduction", "default_eld_ifta_deduction", "status", "notes",
  ],
  vehicles: [
    "unit_number", "vehicle_type", "ownership_type", "company_id",
    "external_carrier_id", "owner_id", "assigned_driver_id",
    "default_driver_pay_pct", "company_fee_pct", "company_fee_is_our_revenue",
    "external_carrier_fee_pct", "management_commission_type",
    "management_commission_amount", "vin", "year", "make", "model", "plate",
    "status", "notes",
  ],
  loads: [
    "load_number", "load_source", "company_id", "external_carrier_id",
    "vehicle_id", "driver_id", "pickup_date", "delivery_date",
    "pickup_location", "delivery_location", "route", "gross_amount",
    "fuel_surcharge", "loaded_miles", "empty_miles", "total_miles", "status", "notes",
  ],
  expenses: [
    "date", "company_id", "external_carrier_id", "vehicle_id", "driver_id",
    "owner_id", "category", "amount", "deduct_from_settlement", "notes",
  ],
  telegram_groups: ["chat_id", "title", "vehicle_id", "driver_id", "company_id", "active"],
  maintenance_rules: [
    "vehicle_id", "service_type", "interval_type", "interval_miles",
    "interval_days", "last_done_mileage", "last_done_date", "active",
  ],
};

export function isAllowedTable(table: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED, table);
}

/** Keep only allowlisted columns; empty string/undefined become null. */
export function clean(table: string, raw: Record<string, unknown>) {
  const cols = ALLOWED[table];
  if (!cols) throw new Error(`Table not allowed: ${table}`);
  const out: Record<string, unknown> = {};
  for (const c of cols) {
    if (c in raw) {
      let v = raw[c];
      if (v === "" || v === undefined) v = null;
      out[c] = v;
    }
  }
  return out;
}

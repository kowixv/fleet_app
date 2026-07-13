import { serviceKey, type ReviewDraftData, type ReviewServiceRow } from "./maintenance-invoice-review";

export { serviceKey };

export const PETERBILT_579_X15_TEMPLATE_NAME = "2023 Peterbilt 579 + Cummins X15 EPA21";
export const ODOMETER_MAX = 2_500_000;

export interface BulkInvoiceDraft {
  id: string;
  file_name: string;
  file_hash: string;
  invoice_date: string | null;
  shop_name: string | null;
  vehicle_id: string | null;
  parsed_data: { parsed?: { unit_number?: string | null; vehicle_id_text?: string | null; vin?: string | null }; review?: ReviewDraftData } | null;
}

export interface ExistingVehicleForBulk {
  id: string;
  unit_number: string;
  vin: string | null;
  current_mileage: number | null;
  prior_completed_invoice_mileages?: number[];
  existing_baselines?: BaselineEvent[];
}

export interface BulkServiceEvent {
  invoice_id: string;
  service_type: string;
  performed_date: string | null;
  mileage: number | null;
  row: ReviewServiceRow;
}

export interface BaselineEvent {
  service_key: string;
  service_type: string;
  date: string | null;
  mileage: number | null;
  invoice_id?: string | null;
}

export interface BulkUnitGroup {
  group_key: string;
  canonical_unit_number: string | null;
  vin: string | null;
  vehicle: ExistingVehicleForBulk | null;
  invoices: BulkInvoiceDraft[];
  services: BulkServiceEvent[];
  valid_mileages: number[];
  highest_invoice_mileage: number | null;
  proposed_current_mileage: number | null;
  status: "new_vehicle" | "existing_vehicle" | "blocked";
  warnings: string[];
  conflicts: string[];
  mapped_baselines: BaselineEvent[];
  unmapped_services: BulkServiceEvent[];
}

export function normalizeUnitNumber(value: string | null | undefined): string | null {
  const cleaned = value
    ?.trim()
    .replace(/^(unit|truck|tractor|vehicle|veh|#)\s*[:#-]?\s*/i, "")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!cleaned) return null;
  if (!/[A-Z0-9]/.test(cleaned)) return null;
  return cleaned;
}

export function extractVin(value: string | null | undefined): string | null {
  const match = value?.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
  return match?.[0] ?? null;
}

export function normalizeMileageCandidate(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > ODOMETER_MAX) return null;
    return value;
  }
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/,/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > ODOMETER_MAX) return null;
  return parsed;
}

export function highestMileage(candidates: Array<unknown>): number | null {
  const valid = candidates.map(normalizeMileageCandidate).filter((value): value is number => value != null);
  return valid.length ? Math.max(...valid) : null;
}

const RECURRING_ALIASES: Array<{ pattern: RegExp; target: string }> = [
  { pattern: /\b(oil change|engine oil and filter|lube service|wet pm|oil service)\b/i, target: "Wet PM / Oil Service" },
  { pattern: /\b(pm service|preventive maintenance a|pm-a|pm a)\b/i, target: "PM-A" },
  { pattern: /\b(pm-b|pm b)\b/i, target: "PM-B" },
  { pattern: /\bengine air filter\b/i, target: "Engine Air Filter" },
  { pattern: /\bcabin air filter\b/i, target: "Cabin Air Filter Inspection/Replacement" },
  { pattern: /\bdef filter\b/i, target: "DEF Filter" },
  { pattern: /\b(valve adjustment|overhead adjustment|valve overhead)\b/i, target: "Valve Overhead" },
  { pattern: /\b(dot inspection|annual dot|dot annual)\b/i, target: "DOT Annual" },
  { pattern: /\bair dryer cartridge|air dryer\b/i, target: "Air Dryer" },
  { pattern: /\bdrive axle oil|synthetic drive axle oil\b/i, target: "Synthetic Drive Axle Oil" },
];

const HISTORY_ONLY_PATTERN = /\b(diagnostic|electrical repair|suspension repair|turbo repair|coolant refill|coolant leak|dpf regeneration|regen|towing|shop supplies|tax|shipping|epa fee)\b/i;

export function mapRecurringService(serviceType: string): { mapped_service_type: string | null; reason: string } {
  if (HISTORY_ONLY_PATTERN.test(serviceType)) {
    return { mapped_service_type: null, reason: "Bakım planına eşleşmedi" };
  }
  const match = RECURRING_ALIASES.find((alias) => alias.pattern.test(serviceType));
  return match ? { mapped_service_type: match.target, reason: "mapped" } : { mapped_service_type: null, reason: "Bakım planına eşleşmedi" };
}

export function chooseLatestBaseline(
  events: BaselineEvent[],
  existing?: Pick<BaselineEvent, "date" | "mileage"> | null,
): { event: BaselineEvent | null; conflict: string | null; preservedExisting: boolean } {
  const dated = events.filter((event) => event.date);
  const sortedByDate = [...dated].sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.mileage ?? -1) - Number(b.mileage ?? -1));
  for (let index = 1; index < sortedByDate.length; index += 1) {
    const prev = sortedByDate[index - 1];
    const next = sortedByDate[index];
    if (prev.mileage != null && next.mileage != null && next.mileage < prev.mileage) {
      return {
        event: null,
        conflict: `Chronological mileage conflict for ${next.service_type}: ${next.date} has lower mileage than ${prev.date}.`,
        preservedExisting: false,
      };
    }
  }

  const candidate = sortedByDate.length
    ? sortedByDate[sortedByDate.length - 1]
    : [...events].filter((event) => event.mileage != null).sort((a, b) => Number(a.mileage) - Number(b.mileage)).at(-1) ?? null;
  if (!candidate) return { event: null, conflict: null, preservedExisting: false };

  if (existing?.date && candidate.date && candidate.date < existing.date) {
    return { event: existing as BaselineEvent, conflict: null, preservedExisting: true };
  }
  if (!candidate.date && existing?.mileage != null && candidate.mileage != null && candidate.mileage < existing.mileage) {
    return { event: existing as BaselineEvent, conflict: null, preservedExisting: true };
  }
  return { event: candidate, conflict: null, preservedExisting: false };
}

export function groupBulkInvoices(
  invoices: BulkInvoiceDraft[],
  vehicles: ExistingVehicleForBulk[],
): BulkUnitGroup[] {
  const byVin = new Map(vehicles.filter((vehicle) => extractVin(vehicle.vin)).map((vehicle) => [extractVin(vehicle.vin)!, vehicle]));
  const byUnit = new Map(vehicles.map((vehicle) => [normalizeUnitNumber(vehicle.unit_number), vehicle]));
  const groups = new Map<string, BulkUnitGroup>();

  for (const invoice of invoices) {
    const review = invoice.parsed_data?.review;
    const parsed = invoice.parsed_data?.parsed;
    const vin = extractVin(parsed?.vin ?? review?.warnings?.join(" "));
    const canonical = normalizeUnitNumber(parsed?.unit_number ?? parsed?.vehicle_id_text ?? null);
    const vinVehicle = vin ? byVin.get(vin) ?? null : null;
    const unitVehicle = canonical ? byUnit.get(canonical) ?? null : null;
    const vehicle = vinVehicle ?? unitVehicle ?? null;
    const conflicts: string[] = [];
    const warnings: string[] = [];
    if (!canonical && !vin) conflicts.push("Unit number güvenli tespit edilemedi.");
    if (vinVehicle && unitVehicle && vinVehicle.id !== unitVehicle.id) conflicts.push("VIN ve unit number farklı araçlara işaret ediyor.");
    const groupKey = vehicle?.id ?? vin ?? canonical ?? `blocked-${invoice.id}`;
    const existing = groups.get(groupKey);
    const group = existing ?? {
      group_key: groupKey,
      canonical_unit_number: vehicle?.unit_number ? normalizeUnitNumber(vehicle.unit_number) : canonical,
      vin,
      vehicle,
      invoices: [],
      services: [],
      valid_mileages: [],
      highest_invoice_mileage: null,
      proposed_current_mileage: vehicle?.current_mileage ?? null,
      status: conflicts.length ? "blocked" : vehicle ? "existing_vehicle" : "new_vehicle",
      warnings: [],
      conflicts: [],
      mapped_baselines: [],
      unmapped_services: [],
    } satisfies BulkUnitGroup;
    if (!existing) {
      for (const prior of vehicle?.prior_completed_invoice_mileages ?? []) {
        const mileage = normalizeMileageCandidate(prior);
        if (mileage != null) group.valid_mileages.push(mileage);
      }
    }
    group.invoices.push(invoice);
    group.warnings.push(...warnings);
    group.conflicts.push(...conflicts);
    if (group.vin && vin && group.vin !== vin) group.conflicts.push("Aynı canonical unit farklı VIN değerleriyle geldi.");

    const invoiceMileage = normalizeMileageCandidate(review?.mileage);
    if (invoiceMileage != null) group.valid_mileages.push(invoiceMileage);
    for (const row of review?.services ?? []) {
      const mileage = normalizeMileageCandidate(row.mileage ?? review?.mileage);
      if (mileage != null) group.valid_mileages.push(mileage);
      group.services.push({
        invoice_id: invoice.id,
        service_type: row.service_type,
        performed_date: row.performed_date ?? review?.invoice_date ?? invoice.invoice_date,
        mileage,
        row,
      });
    }
    group.highest_invoice_mileage = group.valid_mileages.length ? Math.max(...group.valid_mileages) : null;
    group.proposed_current_mileage = Math.max(
      group.vehicle?.current_mileage ?? 0,
      group.highest_invoice_mileage ?? 0,
      ...(group.vehicle?.prior_completed_invoice_mileages ?? []),
    ) || null;
    groups.set(groupKey, group);
  }

  for (const group of groups.values()) {
    const baselineCandidates = new Map<string, BaselineEvent[]>();
    for (const service of group.services) {
      const mapped = mapRecurringService(service.service_type);
      if (!mapped.mapped_service_type) {
        group.unmapped_services.push(service);
        continue;
      }
      const key = serviceKey(mapped.mapped_service_type);
      baselineCandidates.set(key, [
        ...(baselineCandidates.get(key) ?? []),
        {
          service_key: key,
          service_type: mapped.mapped_service_type,
          date: service.performed_date,
          mileage: service.mileage,
          invoice_id: service.invoice_id,
        },
      ]);
    }
    for (const events of baselineCandidates.values()) {
      const existing = group.vehicle?.existing_baselines?.find((baseline) => baseline.service_key === events[0]?.service_key);
      const latest = chooseLatestBaseline(events, existing ?? null);
      if (latest.conflict) group.conflicts.push(latest.conflict);
      if (latest.preservedExisting) group.warnings.push(`${events[0]?.service_type} mevcut daha yeni baseline korundu.`);
      else if (latest.event) group.mapped_baselines.push(latest.event);
    }
    if (group.conflicts.length > 0) group.status = "blocked";
  }

  return [...groups.values()].sort((a, b) => String(a.canonical_unit_number ?? a.group_key).localeCompare(String(b.canonical_unit_number ?? b.group_key)));
}

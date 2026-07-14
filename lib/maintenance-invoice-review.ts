import { suggestMaintenanceCostCategory, type MaintenanceCostCategory } from "@/lib/maintenance-cost";

export type MaintenanceImportMode = "plan" | "history" | "skip";

export interface ParsedInvoiceServiceForReview {
  service_type: string;
  part_name: string | null;
  parts_used: string[];
  performed_date: string | null;
  mileage: number | null;
  cost: number | null;
  notes: string | null;
}

export interface ParsedMaintenanceInvoiceForReview {
  invoice_number: string | null;
  invoice_date: string | null;
  shop_name: string | null;
  unit_number: string | null;
  vehicle_id_text: string | null;
  mileage: number | null;
  services: ParsedInvoiceServiceForReview[];
}

export interface NormalizedMaintenanceService {
  service_type: string;
  parts_used: string[];
  performed_date: string | null;
  mileage: number | null;
  cost: number | null;
  notes: string | null;
  default_action: "plan" | "history";
}

export interface MaintenanceCostAllocationFields {
  category: MaintenanceCostCategory;
  planned: boolean;
  parts_cost: number;
  labor_cost: number;
  shop_fees: number;
  tax_cost: number;
  towing_cost: number;
  road_service_cost: number;
  hotel_travel_cost: number;
  diagnostic_cost: number;
  freight_shipping_cost: number;
  core_charge_cost: number;
  environmental_fee_cost: number;
  machine_shop_cost: number;
  sublet_cost: number;
  other_cost: number;
  warranty_recovery: number;
  refund_credit: number;
  total_cost: number;
  downtime_start: string | null;
  downtime_end: string | null;
  status: string;
  cause: string | null;
  breakdown_occurred: boolean;
}

export interface MaintenanceInvoiceParserMeta {
  source: "text" | "vision";
  confidence: number;
  warnings: string[];
}

export interface MaintenanceImportRecord {
  vehicle_id: string;
  service_type: string;
  part_name: null;
  parts_used: string[];
  performed_date: string | null;
  mileage: number | null;
  cost: number | null;
  shop_name: string | null;
  notes: string | null;
  next_due_mileage: number | null;
  next_due_date: string | null;
  resolution: "overwrite" | "history";
  category: MaintenanceCostCategory;
  planned: boolean;
  parts_cost: number;
  labor_cost: number;
  shop_fees: number;
  tax_cost: number;
  towing_cost: number;
  road_service_cost: number;
  hotel_travel_cost: number;
  diagnostic_cost: number;
  freight_shipping_cost: number;
  core_charge_cost: number;
  environmental_fee_cost: number;
  machine_shop_cost: number;
  sublet_cost: number;
  other_cost: number;
  warranty_recovery: number;
  refund_credit: number;
  total_cost: number;
  downtime_start: string | null;
  downtime_end: string | null;
  status: string;
  cause: string | null;
  breakdown_occurred: boolean;
}

export type InvoiceImportStatus = "pending_review" | "completed" | "duplicate" | "failed" | "cancelled";
export type ExistingRuleDecision = "update_existing" | "history_only" | "skip";

export interface VehicleOption {
  id: string;
  unit_number: string;
  current_mileage: number | null;
}

export interface ServiceDefault {
  service_key: string;
  service_type: string;
  default_mode: MaintenanceImportMode;
  interval_type: "mileage" | "date" | null;
  interval_miles: number | null;
  interval_days: number | null;
}

export interface ReviewServiceRow extends NormalizedMaintenanceService, MaintenanceCostAllocationFields {
  id: string;
  mode: MaintenanceImportMode;
  next_due_mileage: number | null;
  next_due_date: string | null;
  existing_rule_id: string | null;
  existing_rule_summary: string | null;
  existing_rule_decision: ExistingRuleDecision | null;
}

export function defaultCostAllocationForService(
  service: Pick<NormalizedMaintenanceService, "service_type" | "cost" | "default_action">,
): MaintenanceCostAllocationFields {
  const total = Number(service.cost ?? 0);
  return {
    category: suggestMaintenanceCostCategory(service.service_type),
    planned: service.default_action === "plan",
    parts_cost: 0,
    labor_cost: 0,
    shop_fees: 0,
    tax_cost: 0,
    towing_cost: 0,
    road_service_cost: 0,
    hotel_travel_cost: 0,
    diagnostic_cost: 0,
    freight_shipping_cost: 0,
    core_charge_cost: 0,
    environmental_fee_cost: 0,
    machine_shop_cost: 0,
    sublet_cost: 0,
    other_cost: total,
    warranty_recovery: 0,
    refund_credit: 0,
    total_cost: total,
    downtime_start: null,
    downtime_end: null,
    status: "completed",
    cause: null,
    breakdown_occurred: false,
  };
}

export interface ReviewDraftData {
  organization_id: string;
  suggested_vehicle_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  vendor: string | null;
  mileage: number | null;
  total: number | null;
  services: ReviewServiceRow[];
  parser: MaintenanceInvoiceParserMeta;
  warnings: string[];
}

export interface ExistingRuleLookup {
  vehicle_id: string;
  service_key: string;
  id: string;
  summary: string;
}

export function serviceKey(serviceType: string): string {
  return serviceType
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function detectDuplicateHash(
  hash: string,
  existing: Array<{ file_hash: string; status: InvoiceImportStatus }>,
): { duplicate: boolean; status: InvoiceImportStatus | null } {
  const match = existing.find((row) => row.file_hash === hash);
  return { duplicate: !!match, status: match?.status ?? null };
}

function uniquePush(values: string[], value: string | null | undefined) {
  const cleaned = value?.replace(/\s+/g, " ").trim() ?? "";
  if (cleaned && !values.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) values.push(cleaned);
}

function canonicalService(service: ParsedInvoiceServiceForReview): { serviceType: string; parts: string[] } {
  const haystack = serviceKey([service.service_type, service.part_name, ...service.parts_used, service.notes].filter(Boolean).join(" "));
  const parts: string[] = [];
  for (const part of service.parts_used) uniquePush(parts, part);
  uniquePush(parts, service.part_name);
  if (/\b(full )?(chassis )?(inspection|inspect)\b/.test(haystack)) return { serviceType: "Full Inspection", parts: [] };
  if (/\b(electrical|wiring|wire harness|light circuit|battery cable|alternator|starter)\b/.test(haystack)) return { serviceType: "Electrical System Repair", parts };
  if (/\bhalo\b/.test(haystack)) return { serviceType: "Halo Installation", parts };
  if (/\b(suspension|tender spring|shock absorber|shock absorbers|strut|leaf spring|air spring)\b/.test(haystack)) {
    if (/\btender spring\b/.test(haystack)) uniquePush(parts, "tender spring");
    if (/\bshock absorbers?\b/.test(haystack)) uniquePush(parts, haystack.includes("shock absorbers") ? "shock absorbers" : "shock absorber");
    return { serviceType: "Suspension Repair", parts };
  }
  if (/\b(engine air filter|air filter engine)\b/.test(haystack)) return { serviceType: "Engine Air Filter Replacement", parts: [] };
  if (/\b(cabin air filter|cab air filter|air filter cabin)\b/.test(haystack)) return { serviceType: "Cabin Air Filter Replacement", parts: [] };
  if (/\b(tripac|tri pac|apu)\b/.test(haystack)) return { serviceType: "TriPac/APU Repair", parts };
  if (/\b(dpf|diesel particulate).*\b(regen|regeneration|regenerate)\b|\b(regen|regeneration).*\bdpf\b/.test(haystack)) return { serviceType: "DPF Regeneration", parts: [] };
  if (/\b(coolant|antifreeze)\b/.test(haystack)) return { serviceType: "Coolant Service", parts };
  return { serviceType: service.service_type.replace(/\s+/g, " ").trim(), parts };
}

function defaultAction(serviceType: string): "plan" | "history" {
  return /\b(repair|installation|inspection|regeneration|coolant|refill)\b/i.test(serviceType) ? "history" : "plan";
}

export function normalizeReviewServices(services: ParsedInvoiceServiceForReview[]): NormalizedMaintenanceService[] {
  const grouped = new Map<string, NormalizedMaintenanceService>();
  for (const service of services) {
    const canonical = canonicalService(service);
    const key = serviceKey(canonical.serviceType);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        service_type: canonical.serviceType,
        parts_used: [...canonical.parts],
        performed_date: service.performed_date,
        mileage: service.mileage,
        cost: service.cost,
        notes: service.notes,
        default_action: defaultAction(canonical.serviceType),
      });
      continue;
    }
    for (const part of canonical.parts) uniquePush(existing.parts_used, part);
    existing.cost = (existing.cost ?? 0) + (service.cost ?? 0);
    if (existing.cost === 0 && service.cost == null) existing.cost = null;
    existing.performed_date ??= service.performed_date;
    existing.mileage ??= service.mileage;
  }
  return [...grouped.values()];
}

export function applyServiceDefaults(
  services: NormalizedMaintenanceService[],
  defaults: ServiceDefault[],
): ReviewServiceRow[] {
  const defaultsByKey = new Map(defaults.map((item) => [item.service_key, item]));
  return services.map((service, index) => {
    const key = serviceKey(service.service_type);
    const saved = defaultsByKey.get(key);
    const mode = saved?.default_mode ?? service.default_action;
    return {
      ...service,
      ...defaultCostAllocationForService(service),
      id: `svc-${index + 1}`,
      mode,
      next_due_mileage:
        mode === "plan" && saved?.interval_type === "mileage" && service.mileage != null && saved.interval_miles != null
          ? service.mileage + saved.interval_miles
          : null,
      next_due_date: null,
      existing_rule_id: null,
      existing_rule_summary: null,
      existing_rule_decision: null,
    };
  });
}

export function normalizeReviewServiceRow(row: ReviewServiceRow): ReviewServiceRow {
  const allocation = defaultCostAllocationForService(row);
  const totalCost = Number(row.total_cost ?? row.cost ?? allocation.total_cost);
  return {
    ...row,
    category: row.category ?? allocation.category,
    planned: row.planned ?? allocation.planned,
    parts_cost: Number(row.parts_cost ?? allocation.parts_cost),
    labor_cost: Number(row.labor_cost ?? allocation.labor_cost),
    shop_fees: Number(row.shop_fees ?? allocation.shop_fees),
    tax_cost: Number(row.tax_cost ?? allocation.tax_cost),
    towing_cost: Number(row.towing_cost ?? allocation.towing_cost),
    road_service_cost: Number(row.road_service_cost ?? allocation.road_service_cost),
    hotel_travel_cost: Number(row.hotel_travel_cost ?? allocation.hotel_travel_cost),
    diagnostic_cost: Number(row.diagnostic_cost ?? allocation.diagnostic_cost),
    freight_shipping_cost: Number(row.freight_shipping_cost ?? allocation.freight_shipping_cost),
    core_charge_cost: Number(row.core_charge_cost ?? allocation.core_charge_cost),
    environmental_fee_cost: Number(row.environmental_fee_cost ?? allocation.environmental_fee_cost),
    machine_shop_cost: Number(row.machine_shop_cost ?? allocation.machine_shop_cost),
    sublet_cost: Number(row.sublet_cost ?? allocation.sublet_cost),
    other_cost: Number(row.other_cost ?? row.cost ?? allocation.other_cost),
    warranty_recovery: Number(row.warranty_recovery ?? allocation.warranty_recovery),
    refund_credit: Number(row.refund_credit ?? allocation.refund_credit),
    total_cost: Number.isFinite(totalCost) ? totalCost : allocation.total_cost,
    downtime_start: row.downtime_start ?? allocation.downtime_start,
    downtime_end: row.downtime_end ?? allocation.downtime_end,
    status: row.status ?? allocation.status,
    cause: row.cause ?? allocation.cause,
    breakdown_occurred: Boolean(row.breakdown_occurred ?? allocation.breakdown_occurred),
  };
}

export function normalizeReviewServiceRows(rows: ReviewServiceRow[]): ReviewServiceRow[] {
  return rows.map(normalizeReviewServiceRow);
}

export function createReviewDraftData({
  organizationId,
  parsed,
  parser,
  vehicles,
  defaults,
}: {
  organizationId: string;
  parsed: ParsedMaintenanceInvoiceForReview;
  parser: MaintenanceInvoiceParserMeta;
  vehicles: VehicleOption[];
  defaults: ServiceDefault[];
}): ReviewDraftData {
  const detected = (parsed.unit_number ?? parsed.vehicle_id_text)?.trim().toLowerCase();
  const suggested = detected
    ? vehicles.find((vehicle) => vehicle.unit_number.trim().toLowerCase() === detected)
    : null;
  const normalized = normalizeReviewServices(parsed.services);
  const services = applyServiceDefaults(normalized, defaults);
  const warnings = [...parser.warnings];
  if (!suggested) warnings.push("Araç eşleşmesi onay bekliyor.");
  return {
    organization_id: organizationId,
    suggested_vehicle_id: suggested?.id ?? null,
    invoice_number: parsed.invoice_number,
    invoice_date: parsed.invoice_date,
    vendor: parsed.shop_name,
    mileage: parsed.mileage,
    total: services.reduce((sum, service) => sum + Number(service.cost ?? 0), 0),
    services,
    parser,
    warnings,
  };
}

export function mergeServiceRows(rows: ReviewServiceRow[], sourceId: string, targetId: string): ReviewServiceRow[] {
  const source = rows.find((row) => row.id === sourceId);
  if (!source || sourceId === targetId) return rows;
  return rows
    .filter((row) => row.id !== sourceId)
    .map((row) => {
      if (row.id !== targetId) return row;
      const parts = [...row.parts_used];
      for (const part of source.parts_used) {
        if (!parts.some((existing) => existing.toLowerCase() === part.toLowerCase())) parts.push(part);
      }
      return {
        ...row,
        parts_used: parts,
        cost: Number(row.cost ?? 0) + Number(source.cost ?? 0),
        diagnostic_cost: Number(row.diagnostic_cost ?? 0) + Number(source.diagnostic_cost ?? 0),
        freight_shipping_cost: Number(row.freight_shipping_cost ?? 0) + Number(source.freight_shipping_cost ?? 0),
        core_charge_cost: Number(row.core_charge_cost ?? 0) + Number(source.core_charge_cost ?? 0),
        environmental_fee_cost: Number(row.environmental_fee_cost ?? 0) + Number(source.environmental_fee_cost ?? 0),
        machine_shop_cost: Number(row.machine_shop_cost ?? 0) + Number(source.machine_shop_cost ?? 0),
        sublet_cost: Number(row.sublet_cost ?? 0) + Number(source.sublet_cost ?? 0),
        other_cost: Number(row.other_cost ?? 0) + Number(source.other_cost ?? 0),
        total_cost: Number(row.total_cost ?? 0) + Number(source.total_cost ?? 0),
        warranty_recovery: Number(row.warranty_recovery ?? 0) + Number(source.warranty_recovery ?? 0),
        refund_credit: Number(row.refund_credit ?? 0) + Number(source.refund_credit ?? 0),
        notes: [row.notes, source.notes].filter(Boolean).join(" | ") || null,
      };
    });
}

export function deleteServiceRow(rows: ReviewServiceRow[], rowId: string): ReviewServiceRow[] {
  return rows.filter((row) => row.id !== rowId);
}

export function applyExistingRules(
  rows: ReviewServiceRow[],
  vehicleId: string | null,
  rules: ExistingRuleLookup[],
): ReviewServiceRow[] {
  if (!vehicleId) return rows;
  return rows.map((row) => {
    const rule = rules.find((item) => item.vehicle_id === vehicleId && item.service_key === serviceKey(row.service_type));
    return rule
      ? {
          ...row,
          existing_rule_id: rule.id,
          existing_rule_summary: rule.summary,
          existing_rule_decision: row.mode === "plan" ? "update_existing" : "history_only",
        }
      : row;
  });
}

export function mileageWarnings({
  currentMileage,
  invoiceMileage,
}: {
  currentMileage: number | null;
  invoiceMileage: number | null;
}): string[] {
  const warnings: string[] = [];
  if (currentMileage == null || currentMileage === 0) warnings.push("Araç mileage değeri eksik veya 0; kaydetmeden önce doğru mileage girin.");
  if (currentMileage != null && invoiceMileage != null && invoiceMileage < currentMileage) {
    warnings.push(`Invoice mileage (${invoiceMileage}) mevcut mileage değerinden (${currentMileage}) düşük; araç mileage otomatik düşürülmez.`);
  }
  return warnings;
}

export function buildFinalImportRecords({
  rows,
  vehicleId,
  vehicleCurrentMileage,
  invoiceMileage,
  vendor,
  invoiceDate,
}: {
  rows: ReviewServiceRow[];
  vehicleId: string;
  vehicleCurrentMileage: number | null;
  invoiceMileage: number | null;
  vendor: string | null;
  invoiceDate: string | null;
}): MaintenanceImportRecord[] {
  const records: MaintenanceImportRecord[] = [];
  for (const row of rows) {
    const mode = row.existing_rule_decision === "skip" ? "skip" : row.existing_rule_decision === "history_only" ? "history" : row.mode;
    const built = buildReviewImportRecord({
      service: row,
      mode,
      vehicleId,
      vehicleCurrentMileage,
      invoiceMileage,
      invoiceShopName: vendor,
      performedDate: row.performed_date ?? invoiceDate,
      nextDue: { next_due_mileage: row.next_due_mileage, next_due_date: row.next_due_date },
    });
    if (built.record) records.push(built.record);
  }
  return records;
}

export function buildReviewImportRecord({
  service,
  mode,
  vehicleId,
  vehicleCurrentMileage,
  invoiceMileage,
  invoiceShopName,
  performedDate,
  nextDue = { next_due_mileage: null, next_due_date: null },
}: {
  service: NormalizedMaintenanceService;
  mode: MaintenanceImportMode;
  vehicleId: string;
  vehicleCurrentMileage: number | null;
  invoiceMileage: number | null;
  invoiceShopName: string | null;
  performedDate: string | null;
  nextDue?: { next_due_mileage: number | null; next_due_date: string | null };
}): { record: MaintenanceImportRecord | null; zeroMileageRuleWarning: boolean } {
  if (mode === "skip") return { record: null, zeroMileageRuleWarning: false };
  const mileage = service.mileage ?? invoiceMileage ?? vehicleCurrentMileage;
  const shouldPlan = mode === "plan" && (nextDue.next_due_mileage != null || nextDue.next_due_date != null);
  const allocation = {
    ...defaultCostAllocationForService(service),
    ...(service as Partial<MaintenanceCostAllocationFields>),
  };
  return {
    zeroMileageRuleWarning: shouldPlan && nextDue.next_due_mileage != null && Number(vehicleCurrentMileage ?? 0) === 0,
    record: {
      vehicle_id: vehicleId,
      service_type: service.service_type.trim(),
      part_name: null,
      parts_used: service.parts_used,
      performed_date: performedDate,
      mileage: mileage == null ? null : Number(mileage),
      cost: service.cost,
      shop_name: invoiceShopName,
      notes: service.notes,
      next_due_mileage: shouldPlan ? nextDue.next_due_mileage : null,
      next_due_date: shouldPlan ? nextDue.next_due_date : null,
      resolution: shouldPlan ? "overwrite" : "history",
      category: allocation.category,
      planned: shouldPlan || allocation.planned,
      parts_cost: allocation.parts_cost,
      labor_cost: allocation.labor_cost,
      shop_fees: allocation.shop_fees,
      tax_cost: allocation.tax_cost,
      towing_cost: allocation.towing_cost,
      road_service_cost: allocation.road_service_cost,
      hotel_travel_cost: allocation.hotel_travel_cost,
      diagnostic_cost: allocation.diagnostic_cost,
      freight_shipping_cost: allocation.freight_shipping_cost,
      core_charge_cost: allocation.core_charge_cost,
      environmental_fee_cost: allocation.environmental_fee_cost,
      machine_shop_cost: allocation.machine_shop_cost,
      sublet_cost: allocation.sublet_cost,
      other_cost: allocation.other_cost,
      warranty_recovery: allocation.warranty_recovery,
      refund_credit: allocation.refund_credit,
      total_cost: allocation.total_cost,
      downtime_start: allocation.downtime_start,
      downtime_end: allocation.downtime_end,
      status: allocation.status,
      cause: allocation.cause,
      breakdown_occurred: allocation.breakdown_occurred,
    },
  };
}

export function undoIsolatedIds(invoiceId: string, records: Array<{ id: string; invoice_id: string | null }>): string[] {
  return records.filter((record) => record.invoice_id === invoiceId).map((record) => record.id);
}

export function canCreateExpenseForInvoice(
  invoiceHashValue: string,
  existingExpenses: Array<{ invoice_hash: string | null }>,
): boolean {
  return !existingExpenses.some((expense) => expense.invoice_hash === invoiceHashValue);
}

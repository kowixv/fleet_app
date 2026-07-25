export const WORK_ORDER_STATUSES = [
  "reported",
  "triage",
  "awaiting_estimate",
  "awaiting_approval",
  "approved",
  "parts_ordered",
  "scheduled",
  "in_repair",
  "quality_check",
  "completed",
  "invoiced",
  "closed",
  "cancelled",
] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

export const WORK_ORDER_SOURCE_TYPES = [
  "inspection_finding",
  "maintenance_reminder",
  "manual",
  "breakdown",
  "invoice_review",
] as const;
export type WorkOrderSourceType = (typeof WORK_ORDER_SOURCE_TYPES)[number];

export const WORK_ORDER_APPROVAL_STATES = ["not_required", "pending", "approved", "rejected"] as const;
export type WorkOrderApprovalState = (typeof WORK_ORDER_APPROVAL_STATES)[number];

export const WORK_ORDER_TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export type WorkOrderTaskStatus = (typeof WORK_ORDER_TASK_STATUSES)[number];

export const WORK_ORDER_PART_STATUSES = ["needed", "ordered", "received", "installed", "cancelled"] as const;
export type WorkOrderPartStatus = (typeof WORK_ORDER_PART_STATUSES)[number];

const TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  reported: ["triage", "cancelled"],
  triage: ["awaiting_estimate", "approved", "scheduled", "cancelled"],
  awaiting_estimate: ["awaiting_approval", "approved", "cancelled"],
  awaiting_approval: ["approved", "awaiting_estimate", "cancelled"],
  approved: ["parts_ordered", "scheduled", "in_repair", "cancelled"],
  parts_ordered: ["scheduled", "in_repair", "cancelled"],
  scheduled: ["in_repair", "cancelled"],
  in_repair: ["quality_check", "completed", "cancelled"],
  quality_check: ["in_repair", "completed", "cancelled"],
  completed: ["invoiced", "closed"],
  invoiced: ["closed"],
  closed: [],
  cancelled: [],
};

const TASK_TRANSITIONS: Record<WorkOrderTaskStatus, readonly WorkOrderTaskStatus[]> = {
  pending: ["in_progress", "completed", "cancelled"],
  in_progress: ["pending", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const PART_TRANSITIONS: Record<WorkOrderPartStatus, readonly WorkOrderPartStatus[]> = {
  needed: ["ordered", "cancelled"],
  ordered: ["received", "cancelled"],
  received: ["installed", "cancelled"],
  installed: [],
  cancelled: [],
};

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  reported: "Bildirildi",
  triage: "Ön İnceleme",
  awaiting_estimate: "Tahmin Bekliyor",
  awaiting_approval: "Onay Bekliyor",
  approved: "Onaylandı",
  parts_ordered: "Parça Sipariş Edildi",
  scheduled: "Planlandı",
  in_repair: "Tamirde",
  quality_check: "Kalite Kontrol",
  completed: "Tamamlandı",
  invoiced: "Faturalandı",
  closed: "Kapatıldı",
  cancelled: "İptal Edildi",
};

const PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  critical: "Kritik",
};

const SOURCE_LABELS: Record<WorkOrderSourceType, string> = {
  inspection_finding: "Inspection Bulgusu",
  maintenance_reminder: "Bakım Hatırlatıcısı",
  manual: "Manuel",
  breakdown: "Arıza / Breakdown",
  invoice_review: "Invoice İncelemesi",
};

export function isWorkOrderStatus(value: unknown): value is WorkOrderStatus {
  return typeof value === "string" && WORK_ORDER_STATUSES.includes(value as WorkOrderStatus);
}

export function isWorkOrderPriority(value: unknown): value is WorkOrderPriority {
  return typeof value === "string" && WORK_ORDER_PRIORITIES.includes(value as WorkOrderPriority);
}

export function isWorkOrderSourceType(value: unknown): value is WorkOrderSourceType {
  return typeof value === "string" && WORK_ORDER_SOURCE_TYPES.includes(value as WorkOrderSourceType);
}

export function isWorkOrderTaskStatus(value: unknown): value is WorkOrderTaskStatus {
  return typeof value === "string" && WORK_ORDER_TASK_STATUSES.includes(value as WorkOrderTaskStatus);
}

export function isWorkOrderPartStatus(value: unknown): value is WorkOrderPartStatus {
  return typeof value === "string" && WORK_ORDER_PART_STATUSES.includes(value as WorkOrderPartStatus);
}

export function workOrderStatusLabel(status: WorkOrderStatus | string): string {
  return isWorkOrderStatus(status) ? STATUS_LABELS[status] : status;
}

export function workOrderPriorityLabel(priority: WorkOrderPriority | string): string {
  return isWorkOrderPriority(priority) ? PRIORITY_LABELS[priority] : priority;
}

export function workOrderSourceLabel(source: WorkOrderSourceType | string): string {
  return isWorkOrderSourceType(source) ? SOURCE_LABELS[source] : source;
}

export function allowedWorkOrderTransitions(status: WorkOrderStatus): readonly WorkOrderStatus[] {
  return TRANSITIONS[status];
}

export function canTransitionWorkOrder(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertWorkOrderTransition(from: unknown, to: unknown): asserts from is WorkOrderStatus {
  if (!isWorkOrderStatus(from) || !isWorkOrderStatus(to) || !canTransitionWorkOrder(from, to)) {
    throw new Error("Bu work order status geçişine izin verilmiyor.");
  }
}

export function canTransitionWorkOrderTask(from: WorkOrderTaskStatus, to: WorkOrderTaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function canTransitionWorkOrderPart(from: WorkOrderPartStatus, to: WorkOrderPartStatus): boolean {
  return PART_TRANSITIONS[from].includes(to);
}

function text(value: FormDataEntryValue | null, max = 2_000): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized.slice(0, max) : null;
}

function requiredText(value: FormDataEntryValue | null, label: string, max = 500): string {
  const normalized = text(value, max);
  if (!normalized) throw new Error(`${label} gerekli.`);
  return normalized;
}

function optionalMoney(value: FormDataEntryValue | null, label: string): number | null {
  const normalized = text(value);
  if (normalized == null) return null;
  const parsed = Number(normalized.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} negatif olamaz.`);
  return Math.round(parsed * 100) / 100;
}

function optionalNonNegativeNumber(value: FormDataEntryValue | null, label: string): number | null {
  const normalized = text(value);
  if (normalized == null) return null;
  const parsed = Number(normalized.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} geçerli ve negatif olmayan bir sayı olmalı.`);
  return parsed;
}

function optionalPositiveNumber(value: FormDataEntryValue | null, label: string): number | null {
  const parsed = optionalNonNegativeNumber(value, label);
  if (parsed != null && parsed <= 0) throw new Error(`${label} sıfırdan büyük olmalı.`);
  return parsed;
}

function optionalDate(value: FormDataEntryValue | null, label: string): string | null {
  const normalized = text(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`${label} geçersiz.`);
  const [year, month, day] = normalized.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} geçersiz.`);
  }
  return normalized;
}

function optionalDateTime(value: FormDataEntryValue | null, label: string): string | null {
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`${label} geçersiz.`);
  return new Date(parsed).toISOString();
}

function optionalId(value: FormDataEntryValue | null): string | null {
  const normalized = text(value, 100);
  if (!normalized) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error("Geçersiz kayıt kimliği.");
  }
  return normalized;
}

export interface WorkOrderCreatePayload {
  vehicle_id: string;
  source_type: WorkOrderSourceType;
  source_id: string | null;
  title: string;
  complaint: string | null;
  diagnosis: string | null;
  recommended_action: string | null;
  priority: WorkOrderPriority;
  assigned_user_id: string | null;
  shop_vendor: string | null;
  shop_contact: string | null;
  appointment_start: string | null;
  estimated_completion: string | null;
  estimated_cost: number | null;
  approved_cost_limit: number | null;
  downtime_start: string | null;
  odometer: number | null;
  engine_hours: number | null;
  notes: string | null;
}

export function parseWorkOrderCreateForm(formData: FormData): WorkOrderCreatePayload {
  const sourceType = text(formData.get("source_type"), 50) ?? "manual";
  if (!isWorkOrderSourceType(sourceType)) throw new Error("Work order kaynağı geçersiz.");
  const priority = text(formData.get("priority"), 30) ?? "normal";
  if (!isWorkOrderPriority(priority)) throw new Error("Öncelik geçersiz.");
  const payload: WorkOrderCreatePayload = {
    vehicle_id: requiredText(formData.get("vehicle_id"), "Unit", 100),
    source_type: sourceType,
    source_id: optionalId(formData.get("source_id")),
    title: requiredText(formData.get("title"), "Başlık", 200),
    complaint: text(formData.get("complaint")),
    diagnosis: text(formData.get("diagnosis")),
    recommended_action: text(formData.get("recommended_action")),
    priority,
    assigned_user_id: optionalId(formData.get("assigned_user_id")),
    shop_vendor: text(formData.get("shop_vendor"), 300),
    shop_contact: text(formData.get("shop_contact"), 300),
    appointment_start: optionalDateTime(formData.get("appointment_start"), "Randevu başlangıcı"),
    estimated_completion: optionalDateTime(formData.get("estimated_completion"), "Tahmini tamamlanma"),
    estimated_cost: optionalMoney(formData.get("estimated_cost"), "Tahmini maliyet"),
    approved_cost_limit: optionalMoney(formData.get("approved_cost_limit"), "Onaylı maliyet limiti"),
    downtime_start: optionalDateTime(formData.get("downtime_start"), "Downtime başlangıcı"),
    odometer: optionalNonNegativeNumber(formData.get("odometer"), "Odometer"),
    engine_hours: optionalNonNegativeNumber(formData.get("engine_hours"), "Engine hours"),
    notes: text(formData.get("notes"), 5_000),
  };
  if (
    payload.appointment_start &&
    payload.estimated_completion &&
    Date.parse(payload.estimated_completion) < Date.parse(payload.appointment_start)
  ) {
    throw new Error("Tahmini tamamlanma randevu başlangıcından önce olamaz.");
  }
  return payload;
}

export interface WorkOrderDetailsPayload {
  title: string;
  complaint: string | null;
  diagnosis: string | null;
  recommended_action: string | null;
  priority: WorkOrderPriority;
  assigned_user_id: string | null;
  shop_vendor: string | null;
  shop_contact: string | null;
  appointment_start: string | null;
  estimated_completion: string | null;
  estimated_cost: number | null;
  approved_cost_limit: number | null;
  final_cost: number | null;
  downtime_start: string | null;
  downtime_end: string | null;
  odometer: number | null;
  engine_hours: number | null;
  notes: string | null;
}

export function parseWorkOrderDetailsForm(formData: FormData): WorkOrderDetailsPayload {
  const base = parseWorkOrderCreateForm(formData);
  const downtimeEnd = optionalDateTime(formData.get("downtime_end"), "Downtime bitişi");
  if (base.downtime_start && downtimeEnd && Date.parse(downtimeEnd) < Date.parse(base.downtime_start)) {
    throw new Error("Downtime bitişi başlangıcından önce olamaz.");
  }
  return {
    title: base.title,
    complaint: base.complaint,
    diagnosis: base.diagnosis,
    recommended_action: base.recommended_action,
    priority: base.priority,
    assigned_user_id: base.assigned_user_id,
    shop_vendor: base.shop_vendor,
    shop_contact: base.shop_contact,
    appointment_start: base.appointment_start,
    estimated_completion: base.estimated_completion,
    estimated_cost: base.estimated_cost,
    approved_cost_limit: base.approved_cost_limit,
    final_cost: optionalMoney(formData.get("final_cost"), "Final maliyet"),
    downtime_start: base.downtime_start,
    downtime_end: downtimeEnd,
    odometer: base.odometer,
    engine_hours: base.engine_hours,
    notes: base.notes,
  };
}

export interface WorkOrderTaskPayload {
  title: string;
  notes: string | null;
  due_date: string | null;
  priority: WorkOrderPriority;
  assigned_user_id: string | null;
}

export function parseWorkOrderTaskForm(formData: FormData): WorkOrderTaskPayload {
  const priority = text(formData.get("priority"), 30) ?? "normal";
  if (!isWorkOrderPriority(priority)) throw new Error("Task önceliği geçersiz.");
  return {
    title: requiredText(formData.get("title"), "Task başlığı", 300),
    notes: text(formData.get("notes"), 2_000),
    due_date: optionalDate(formData.get("due_date"), "Task due date"),
    priority,
    assigned_user_id: optionalId(formData.get("assigned_user_id")),
  };
}

export interface WorkOrderPartPayload {
  part_name: string;
  part_number: string | null;
  quantity: number;
  vendor: string | null;
  ordered_date: string | null;
  expected_date: string | null;
  received_date: string | null;
  unit_cost: number | null;
  core_charge: number | null;
  core_returned: boolean;
}

export function parseWorkOrderPartForm(formData: FormData): WorkOrderPartPayload {
  const quantity = optionalPositiveNumber(formData.get("quantity"), "Miktar") ?? 1;
  const orderedDate = optionalDate(formData.get("ordered_date"), "Sipariş tarihi");
  const expectedDate = optionalDate(formData.get("expected_date"), "Beklenen tarih");
  const receivedDate = optionalDate(formData.get("received_date"), "Teslim tarihi");
  if (orderedDate && receivedDate && receivedDate < orderedDate) {
    throw new Error("Teslim tarihi sipariş tarihinden önce olamaz.");
  }
  return {
    part_name: requiredText(formData.get("part_name"), "Parça adı", 300),
    part_number: text(formData.get("part_number"), 200),
    quantity,
    vendor: text(formData.get("vendor"), 300),
    ordered_date: orderedDate,
    expected_date: expectedDate,
    received_date: receivedDate,
    unit_cost: optionalMoney(formData.get("unit_cost"), "Birim maliyet"),
    core_charge: optionalMoney(formData.get("core_charge"), "Core charge"),
    core_returned: formData.get("core_returned") === "on",
  };
}

export function workOrderApprovalRequired(estimatedCost: number | null, threshold: number): boolean {
  return estimatedCost != null && Number.isFinite(estimatedCost) && estimatedCost > Math.max(0, threshold);
}

function daysBetween(start: string | null | undefined, end: Date): number | null {
  if (!start) return null;
  const startMs = Date.parse(start);
  if (!Number.isFinite(startMs)) return null;
  return Math.max(0, Math.round(((end.getTime() - startMs) / 86_400_000) * 10) / 10);
}

export interface WorkOrderTimingInput {
  status: WorkOrderStatus;
  status_changed_at: string;
  downtime_start: string | null;
  downtime_end: string | null;
  actual_start: string | null;
  actual_completion: string | null;
}

export interface WorkOrderTimingMetrics {
  currentDowntimeDays: number | null;
  daysWaitingForEstimate: number | null;
  daysWaitingForParts: number | null;
  daysInRepair: number | null;
}

export function calculateWorkOrderTiming(
  input: WorkOrderTimingInput,
  now = new Date(),
): WorkOrderTimingMetrics {
  const downtimeEnd = input.downtime_end ? new Date(input.downtime_end) : now;
  const repairEnd = input.actual_completion ? new Date(input.actual_completion) : now;
  return {
    currentDowntimeDays: daysBetween(input.downtime_start, downtimeEnd),
    daysWaitingForEstimate: input.status === "awaiting_estimate"
      ? daysBetween(input.status_changed_at, now)
      : null,
    daysWaitingForParts: input.status === "parts_ordered"
      ? daysBetween(input.status_changed_at, now)
      : null,
    daysInRepair: ["in_repair", "quality_check", "completed", "invoiced", "closed"].includes(input.status)
      ? daysBetween(input.actual_start ?? input.downtime_start, repairEnd)
      : null,
  };
}

export function workOrderStatusTone(status: WorkOrderStatus): string {
  if (status === "cancelled") return "bg-slate-100 text-slate-600";
  if (status === "closed" || status === "completed" || status === "invoiced") return "bg-emerald-100 text-emerald-700";
  if (status === "in_repair" || status === "quality_check") return "bg-blue-100 text-blue-700";
  if (status === "awaiting_approval" || status === "awaiting_estimate" || status === "parts_ordered") {
    return "bg-amber-100 text-amber-800";
  }
  if (status === "reported" || status === "triage") return "bg-red-100 text-red-700";
  return "bg-indigo-100 text-indigo-700";
}

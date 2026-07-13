export type PMStatus = "ok" | "due_soon" | "due_now" | "overdue";

export interface PMThresholds {
  dueSoonMiles: number;
  dueSoonDays: number;
}

export interface PMResult {
  status: PMStatus;
  unit: "miles" | "days";
  nextDue: number | string | null;
  remaining: number | null;
  label: string;
}

const STATUS_LABEL: Record<PMStatus, string> = {
  ok: "OK",
  due_soon: "Due Soon",
  due_now: "Due Now",
  overdue: "Overdue",
};

const STATUS_PRIORITY: Record<PMStatus, number> = {
  overdue: 0,
  due_now: 1,
  due_soon: 2,
  ok: 3,
};

interface Rule {
  interval_type: "mileage" | "date";
  interval_miles: number | null;
  interval_days: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
}

export const DEFAULT_PM_THRESHOLDS: PMThresholds = {
  dueSoonMiles: 2_000,
  dueSoonDays: 7,
};

function validDateOnly(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Calendar-day arithmetic that never depends on browser/server timezone. */
export function addDaysISO(date: string, days: number): string {
  if (!validDateOnly(date) || !Number.isInteger(days)) throw new Error("Invalid date interval");
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function epochDay(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function computePM(
  rule: Rule,
  currentMileage: number,
  thresholds: Partial<PMThresholds> = DEFAULT_PM_THRESHOLDS,
  today: string = new Date().toISOString().slice(0, 10),
): PMResult {
  const dueSoonMiles = Math.max(0, thresholds.dueSoonMiles ?? DEFAULT_PM_THRESHOLDS.dueSoonMiles);
  const dueSoonDays = Math.max(1, thresholds.dueSoonDays ?? DEFAULT_PM_THRESHOLDS.dueSoonDays);

  if (
    rule.interval_type === "mileage" &&
    Number(rule.interval_miles) > 0 &&
    rule.last_done_mileage != null
  ) {
    const nextDue = Number(rule.last_done_mileage) + Number(rule.interval_miles);
    const remaining = nextDue - Number(currentMileage || 0);
    const dueNowMiles = Math.max(1, Math.floor(dueSoonMiles * 0.2));
    let status: PMStatus = "ok";
    if (remaining < 0) status = "overdue";
    else if (remaining <= dueNowMiles) status = "due_now";
    else if (remaining <= dueSoonMiles) status = "due_soon";
    return { status, unit: "miles", nextDue, remaining, label: STATUS_LABEL[status] };
  }

  if (
    rule.interval_type === "date" &&
    Number(rule.interval_days) > 0 &&
    validDateOnly(rule.last_done_date) &&
    validDateOnly(today)
  ) {
    const nextDue = addDaysISO(rule.last_done_date, Number(rule.interval_days));
    const remaining = epochDay(nextDue) - epochDay(today);
    let status: PMStatus = "ok";
    if (remaining < 0) status = "overdue";
    else if (remaining <= 1) status = "due_now";
    else if (remaining <= dueSoonDays) status = "due_soon";
    return { status, unit: "days", nextDue, remaining, label: STATUS_LABEL[status] };
  }

  return { status: "ok", unit: "miles", nextDue: null, remaining: null, label: "—" };
}

export function formatPMRemaining(pm: PMResult): string {
  if (pm.remaining == null) return "—";
  const amount = Math.abs(pm.remaining).toLocaleString("en-US");
  const unit = pm.unit === "miles" ? "mi" : "gün";
  if (pm.remaining < 0) return `${amount} ${unit} gecikti`;
  if (pm.remaining === 0) return pm.unit === "miles" ? "Şimdi yapılmalı" : "Bugün yapılmalı";
  return `${amount} ${unit} kaldı`;
}

/** Severity first; numerical comparison is only valid within the same unit. */
export function comparePMAlerts(a: PMResult, b: PMResult): number {
  const severity = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
  if (severity !== 0) return severity;
  if (a.unit === b.unit) return (a.remaining ?? Number.MAX_SAFE_INTEGER) - (b.remaining ?? Number.MAX_SAFE_INTEGER);
  return a.unit.localeCompare(b.unit);
}

export const PM_BADGE: Record<PMStatus, string> = {
  ok: "bg-green-100 text-green-700",
  due_soon: "bg-amber-100 text-amber-700",
  due_now: "bg-orange-100 text-orange-700",
  overdue: "bg-red-100 text-red-700",
};

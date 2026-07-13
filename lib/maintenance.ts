export type PMStatus = "ok" | "warning" | "due_soon" | "due_now" | "overdue";
export type PMUnit = "miles" | "days" | "engine_hours";
export type DutyCycle = "heavy" | "short_haul" | "normal_otr" | "light";

export interface PMThresholds {
  dueSoonMiles: number;
  dueSoonDays: number;
  dueSoonEngineHours?: number;
}

export interface PMDimensionResult {
  unit: PMUnit;
  nextDue: number | string;
  remaining: number;
  consumedRatio: number;
  status: PMStatus;
}

export interface PMResult {
  status: PMStatus;
  unit: PMUnit;
  triggeredBy: PMUnit | null;
  nextDue: number | string | null;
  remaining: number | null;
  dimensions: PMDimensionResult[];
  label: string;
}

export interface DutyCycleRecommendationInput {
  dutyCycle: DutyCycle | null;
  rolling30DayMpg: number | null;
  idlePercentage: number | null;
  currentIntervalMiles: number | null;
}

export interface DutyCycleRecommendation {
  minMiles: number;
  maxMiles: number;
  label: string;
  warning: string | null;
}

const STATUS_LABEL: Record<PMStatus, string> = {
  ok: "OK",
  warning: "Yaklaşıyor",
  due_soon: "Yakında",
  due_now: "Bugün",
  overdue: "Gecikmiş",
};

const STATUS_PRIORITY: Record<PMStatus, number> = {
  overdue: 0,
  due_now: 1,
  due_soon: 2,
  warning: 3,
  ok: 4,
};

const UNIT_LABEL: Record<PMUnit, string> = {
  miles: "mil",
  days: "gün",
  engine_hours: "engine saat",
};

interface Rule {
  interval_type?: "mileage" | "date";
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours?: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
  last_done_engine_hours?: number | null;
}

export const DEFAULT_PM_THRESHOLDS: Required<PMThresholds> = {
  dueSoonMiles: 2_000,
  dueSoonDays: 7,
  dueSoonEngineHours: 100,
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

function statusForRemaining(remaining: number, dueSoon: number, consumedRatio: number): PMStatus {
  if (remaining < 0) return "overdue";
  if (remaining === 0) return "due_now";
  if (remaining <= dueSoon) return "due_soon";
  if (consumedRatio >= 0.9) return "warning";
  return "ok";
}

function compareDimensions(a: PMDimensionResult, b: PMDimensionResult): number {
  const severity = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
  if (severity !== 0) return severity;
  const consumed = b.consumedRatio - a.consumedRatio;
  if (consumed !== 0) return consumed;
  if (a.unit === b.unit) return a.remaining - b.remaining;
  return a.unit.localeCompare(b.unit);
}

export function computePM(
  rule: Rule,
  currentMileage: number,
  thresholds: Partial<PMThresholds> = DEFAULT_PM_THRESHOLDS,
  today: string = new Date().toISOString().slice(0, 10),
  currentEngineHours: number | null = null,
): PMResult {
  const dueSoonMiles = Math.max(0, thresholds.dueSoonMiles ?? DEFAULT_PM_THRESHOLDS.dueSoonMiles);
  const dueSoonDays = Math.max(1, thresholds.dueSoonDays ?? DEFAULT_PM_THRESHOLDS.dueSoonDays);
  const dueSoonEngineHours = Math.max(
    1,
    thresholds.dueSoonEngineHours ?? DEFAULT_PM_THRESHOLDS.dueSoonEngineHours,
  );
  const dimensions: PMDimensionResult[] = [];

  if (Number(rule.interval_miles) > 0 && rule.last_done_mileage != null) {
    const interval = Number(rule.interval_miles);
    const nextDue = Number(rule.last_done_mileage) + interval;
    const remaining = nextDue - Number(currentMileage || 0);
    const consumedRatio = Math.max(0, (interval - remaining) / interval);
    dimensions.push({
      unit: "miles",
      nextDue,
      remaining,
      consumedRatio,
      status: statusForRemaining(remaining, dueSoonMiles, consumedRatio),
    });
  }

  if (Number(rule.interval_days) > 0 && validDateOnly(rule.last_done_date) && validDateOnly(today)) {
    const interval = Number(rule.interval_days);
    const nextDue = addDaysISO(rule.last_done_date, interval);
    const remaining = epochDay(nextDue) - epochDay(today);
    const consumedRatio = Math.max(0, (interval - remaining) / interval);
    dimensions.push({
      unit: "days",
      nextDue,
      remaining,
      consumedRatio,
      status: statusForRemaining(remaining, dueSoonDays, consumedRatio),
    });
  }

  if (
    Number(rule.interval_engine_hours) > 0 &&
    rule.last_done_engine_hours != null &&
    currentEngineHours != null
  ) {
    const interval = Number(rule.interval_engine_hours);
    const nextDue = Number(rule.last_done_engine_hours) + interval;
    const remaining = nextDue - Number(currentEngineHours || 0);
    const consumedRatio = Math.max(0, (interval - remaining) / interval);
    dimensions.push({
      unit: "engine_hours",
      nextDue,
      remaining,
      consumedRatio,
      status: statusForRemaining(remaining, dueSoonEngineHours, consumedRatio),
    });
  }

  if (dimensions.length === 0) {
    return {
      status: "ok",
      unit: "miles",
      triggeredBy: null,
      nextDue: null,
      remaining: null,
      dimensions: [],
      label: "-",
    };
  }

  const triggered = [...dimensions].sort(compareDimensions)[0];
  return {
    status: triggered.status,
    unit: triggered.unit,
    triggeredBy: triggered.unit,
    nextDue: triggered.nextDue,
    remaining: triggered.remaining,
    dimensions,
    label: STATUS_LABEL[triggered.status],
  };
}

export function formatPMRemaining(pm: PMResult): string {
  if (pm.remaining == null || pm.triggeredBy == null) return "-";
  const amount = Math.abs(pm.remaining).toLocaleString("en-US");
  const unit = UNIT_LABEL[pm.triggeredBy];
  if (pm.remaining < 0) return `${amount} ${unit} gecikti`;
  if (pm.remaining === 0) return `bugün yapılmalı (${unit})`;
  return `${amount} ${unit} kaldı`;
}

export function formatPMDimension(dimension: PMDimensionResult): string {
  const amount = Math.abs(dimension.remaining).toLocaleString("en-US");
  const unit = UNIT_LABEL[dimension.unit];
  if (dimension.remaining < 0) return `${unit}: ${amount} gecikti`;
  if (dimension.remaining === 0) return `${unit}: bugün yapılmalı`;
  return `${unit}: ${amount} kaldı`;
}

export function formatPMWhichever(pm: PMResult): string {
  if (pm.dimensions.length <= 1) return formatPMRemaining(pm);
  return `${formatPMRemaining(pm)}; ilk dolan sınır (${pm.triggeredBy ? UNIT_LABEL[pm.triggeredBy] : "bilinmiyor"})`;
}

/** Severity first; numerical comparison is only valid within the same unit. */
export function comparePMAlerts(a: PMResult, b: PMResult): number {
  const severity = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
  if (severity !== 0) return severity;
  if (a.unit === b.unit) return (a.remaining ?? Number.MAX_SAFE_INTEGER) - (b.remaining ?? Number.MAX_SAFE_INTEGER);
  return a.unit.localeCompare(b.unit);
}

export function recommendWetPMInterval(input: DutyCycleRecommendationInput): DutyCycleRecommendation {
  const mpg = input.rolling30DayMpg;
  const idle = input.idlePercentage;
  const highIdle = idle != null && idle >= 35;
  let minMiles = 50_000;
  let maxMiles = 60_000;
  let label = "Normal OTR";

  if (input.dutyCycle === "heavy" || (mpg != null && mpg < 5) || highIdle) {
    minMiles = 25_000;
    maxMiles = 25_000;
    label = "Heavy / low MPG / high idle";
  } else if (input.dutyCycle === "short_haul" || (mpg != null && mpg >= 5 && mpg < 6)) {
    minMiles = 40_000;
    maxMiles = 50_000;
    label = "Short-haul / 5.0-5.9 MPG";
  } else if (input.dutyCycle === "light") {
    minMiles = 50_000;
    maxMiles = 60_000;
    label = "Light duty";
  }

  const warning =
    input.currentIntervalMiles != null && input.currentIntervalMiles > 60_000
      ? "Intervals above 60,000 miles require oil-analysis support."
      : null;

  return { minMiles, maxMiles, label, warning };
}

export const PM_BADGE: Record<PMStatus, string> = {
  ok: "bg-green-100 text-green-700",
  warning: "bg-yellow-100 text-yellow-700",
  due_soon: "bg-amber-100 text-amber-700",
  due_now: "bg-orange-100 text-orange-700",
  overdue: "bg-red-100 text-red-700",
};

import { localISODate } from "@/lib/format";

export type PMStatus = "ok" | "due_soon" | "due_now" | "overdue";

export interface PMResult {
  status: PMStatus;
  unit: "miles" | "days";
  nextDue: number | string | null; // mileage number or ISO date
  remaining: number | null; // miles or days remaining
  label: string;
}

const STATUS_LABEL: Record<PMStatus, string> = {
  ok: "OK",
  due_soon: "Due Soon",
  due_now: "Due Now",
  overdue: "Overdue",
};

interface Rule {
  interval_type: "mileage" | "date";
  interval_miles: number | null;
  interval_days: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
}

/**
 * Compute maintenance status for a rule.
 * @param currentMileage vehicle's current mileage
 * @param dueSoonMiles threshold (settings.pm_due_soon_miles)
 * @param now reference date (defaults to current time)
 */
export function computePM(
  rule: Rule,
  currentMileage: number,
  dueSoonMiles = 2500,
  now: Date = new Date(),
): PMResult {
  if (rule.interval_type === "mileage" && rule.interval_miles) {
    const nextDue = (rule.last_done_mileage ?? 0) + rule.interval_miles;
    const remaining = nextDue - (currentMileage || 0);
    let status: PMStatus = "ok";
    if (remaining <= 0) status = "overdue";
    else if (remaining <= dueSoonMiles * 0.2) status = "due_now";
    else if (remaining <= dueSoonMiles) status = "due_soon";
    return { status, unit: "miles", nextDue, remaining, label: STATUS_LABEL[status] };
  }

  if (rule.interval_type === "date" && rule.interval_days && rule.last_done_date) {
    const last = new Date(rule.last_done_date);
    const next = new Date(last);
    next.setDate(next.getDate() + rule.interval_days);
    const remaining = Math.ceil((next.getTime() - now.getTime()) / 86_400_000);
    let status: PMStatus = "ok";
    if (remaining <= 0) status = "overdue";
    else if (remaining <= 7) status = "due_now";
    else if (remaining <= 30) status = "due_soon";
    return {
      status,
      unit: "days",
      nextDue: localISODate(next),
      remaining,
      label: STATUS_LABEL[status],
    };
  }

  return { status: "ok", unit: "miles", nextDue: null, remaining: null, label: "—" };
}

export const PM_BADGE: Record<PMStatus, string> = {
  ok: "bg-green-100 text-green-700",
  due_soon: "bg-amber-100 text-amber-700",
  due_now: "bg-orange-100 text-orange-700",
  overdue: "bg-red-100 text-red-700",
};

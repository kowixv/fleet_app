const DAY_MS = 86_400_000;

export interface MileagePoint {
  date: string;
  mileage: number;
}

function day(value: string): number {
  return Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`) / DAY_MS;
}

export function interpolateMileage(points: MileagePoint[], target: string): number | null {
  const sorted = [...points].sort((left, right) => day(left.date) - day(right.date));
  const targetDay = day(target);
  const before = [...sorted].reverse().find((point) => day(point.date) <= targetDay);
  const after = sorted.find((point) => day(point.date) >= targetDay);
  if (!before || !after) return null;
  const beforeDay = day(before.date);
  const afterDay = day(after.date);
  if (beforeDay === targetDay) return before.mileage;
  if (afterDay === targetDay) return after.mileage;
  if (afterDay <= beforeDay || after.mileage < before.mileage) return null;
  return before.mileage
    + (after.mileage - before.mileage)
    * ((targetDay - beforeDay) / (afterDay - beforeDay));
}

export function milesFromAuthoritativeLogs(
  points: MileagePoint[],
  start: string,
  end: string,
): { miles: number; estimated: boolean } | null {
  const startMileage = interpolateMileage(points, start);
  const endMileage = interpolateMileage(points, end);
  if (startMileage == null || endMileage == null || endMileage < startMileage) return null;
  const exactStart = points.some((point) => point.date.slice(0, 10) === start);
  const exactEnd = points.some((point) => point.date.slice(0, 10) === end);
  return {
    miles: Math.round((endMileage - startMileage) * 100) / 100,
    estimated: !(exactStart && exactEnd),
  };
}

export function prorateSnapshotMiles(
  snapshot: { periodStart: string; periodEnd: string; miles: number },
  start: string,
  end: string,
): number {
  const overlapStart = Math.max(day(snapshot.periodStart), day(start));
  const overlapEnd = Math.min(day(snapshot.periodEnd), day(end));
  const overlapDays = Math.max(0, overlapEnd - overlapStart + 1);
  const snapshotDays = Math.max(1, day(snapshot.periodEnd) - day(snapshot.periodStart) + 1);
  return snapshot.miles * (overlapDays / snapshotDays);
}

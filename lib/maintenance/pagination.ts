export const MAINTENANCE_PAGE_SIZE = 50;

export type MaintenanceCursorColumn =
  | "created_at"
  | "updated_at"
  | "logged_at";

export interface MaintenanceCursor {
  sortValue: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SORT_VALUE = /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/;

export function encodeMaintenanceCursor(cursor: MaintenanceCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeMaintenanceCursor(value: string | string[] | undefined): MaintenanceCursor | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || raw.length > 512) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    if (typeof row.sortValue !== "string" || !SORT_VALUE.test(row.sortValue)) return null;
    if (typeof row.id !== "string" || !UUID.test(row.id)) return null;
    return { sortValue: row.sortValue, id: row.id };
  } catch {
    return null;
  }
}

export function maintenanceKeysetFilter(
  column: MaintenanceCursorColumn,
  cursor: MaintenanceCursor,
): string {
  return `${column}.lt.${cursor.sortValue},and(${column}.eq.${cursor.sortValue},id.lt.${cursor.id})`;
}

export function nextMaintenanceCursor<T extends { id: string }>(
  rows: T[],
  value: (row: T) => string,
  pageSize = MAINTENANCE_PAGE_SIZE,
): { rows: T[]; nextCursor: string | null } {
  const visible = rows.slice(0, pageSize);
  const last = visible.at(-1);
  return {
    rows: visible,
    nextCursor: rows.length > pageSize && last
      ? encodeMaintenanceCursor({ sortValue: value(last), id: last.id })
      : null,
  };
}

export function maintenancePageHref(
  pathname: string,
  current: Record<string, string | string[] | undefined>,
  cursorName: string,
  cursor: string,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (key === cursorName || value == null) continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first) params.set(key, first);
  }
  params.set(cursorName, cursor);
  return `${pathname}?${params.toString()}`;
}

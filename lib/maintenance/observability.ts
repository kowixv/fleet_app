type SafeLogValue = string | number | boolean | null;

function safeValue(value: unknown): SafeLogValue | undefined {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.slice(0, 160);
  return undefined;
}

export function maintenanceLog(
  level: "info" | "warn" | "error",
  event: string,
  metadata: Record<string, unknown> = {},
): void {
  const safeMetadata: Record<string, SafeLogValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/token|secret|url|path|text|payload|raw|file_name/i.test(key)) continue;
    const safe = safeValue(value);
    if (safe !== undefined) safeMetadata[key] = safe;
  }
  const line = JSON.stringify({
    level,
    event: event.slice(0, 100),
    scope: "maintenance",
    at: new Date().toISOString(),
    ...safeMetadata,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

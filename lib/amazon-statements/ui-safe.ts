export function safeProfileName(value: unknown): string {
  if (!value || typeof value !== "object") return "-";
  const name = (value as { full_name?: unknown }).full_name;
  return typeof name === "string" && name.trim() ? name : "-";
}

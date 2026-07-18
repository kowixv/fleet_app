import "server-only";

export function throwAmazonUiReadError(operation: string, error: unknown): never {
  const postgrest = error as { code?: unknown; message?: unknown };
  console.error("[amazon-import-ui-read]", {
    operation,
    code: typeof postgrest.code === "string" ? postgrest.code : "unknown",
    message: sanitizeDatabaseMessage(postgrest.message),
  });
  throw new Error("Amazon import data is temporarily unavailable.");
}

function sanitizeDatabaseMessage(message: unknown): string {
  if (typeof message !== "string") return "PostgREST request failed.";
  return message
    .replace(/[A-Fa-f0-9]{32,}/g, "[redacted]")
    .replace(/[A-Fa-f0-9-]{36}/g, "[redacted]")
    .slice(0, 240);
}

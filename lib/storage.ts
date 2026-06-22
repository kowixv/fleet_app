/**
 * Storage path helpers for the private `imports` bucket.
 *
 * Import files are stored under `${organization_id}/...`. Because signed URLs are
 * minted with the service role (which bypasses Storage RLS), the API route MUST
 * prove the caller owns the path before signing it — otherwise any logged-in user
 * could read another organization's files (cross-tenant IDOR).
 */

/**
 * Returns true if `path` is a well-formed import-file path owned by `orgId`.
 * Rejects empty paths, path traversal, absolute paths, and any path not scoped
 * to the caller's organization folder.
 */
export function isOwnedImportPath(path: string | null | undefined, orgId: string): boolean {
  if (!path || !orgId) return false;
  // No traversal, no absolute paths, no backslashes.
  if (path.includes("..") || path.startsWith("/") || path.includes("\\")) return false;
  // Must be scoped to the org's folder: `${orgId}/<rest>`.
  return path.startsWith(`${orgId}/`) && path.length > orgId.length + 1;
}

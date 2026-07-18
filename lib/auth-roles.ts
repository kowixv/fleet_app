export type WriteRole = "owner" | "admin" | "manager";
export type WorkflowAccess = "viewer" | "writer";

export const WRITE_ROLES: readonly WriteRole[] = ["owner", "admin", "manager"];

const WRITE_ROLE_SET = new Set<string>(WRITE_ROLES);

export function normalizeRole(role: unknown): string {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

export function isWriteRole(role: unknown): boolean {
  return WRITE_ROLE_SET.has(normalizeRole(role));
}

export function roleToWorkflowAccess(role: unknown): WorkflowAccess {
  return isWriteRole(role) ? "writer" : "viewer";
}

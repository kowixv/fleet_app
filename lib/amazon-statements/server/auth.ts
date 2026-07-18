import "server-only";

import { requireProfile, requireWriteRole } from "@/lib/auth";
import { roleToWorkflowAccess } from "@/lib/auth-roles";
import type { Profile } from "@/lib/auth";
import type { AmazonWorkflowActor } from "./workflow-types";

function toActor(profile: Profile, access: AmazonWorkflowActor["access"]): AmazonWorkflowActor {
  return {
    id: profile.id,
    organizationId: profile.organization_id,
    role: profile.role,
    access,
  };
}

export async function requireAmazonImportActor(options: { writer?: boolean } = {}): Promise<AmazonWorkflowActor> {
  const profile = options.writer ? await requireWriteRole() : await requireProfile();
  return toActor(profile, options.writer ? "writer" : roleToWorkflowAccess(profile.role));
}

export function assertSameOrganization(actor: AmazonWorkflowActor, organizationId: string, label = "Record"): void {
  if (actor.organizationId !== organizationId) {
    throw new Error(`${label} does not belong to this organization.`);
  }
}

export function assertWriter(actor: AmazonWorkflowActor): void {
  if (actor.access !== "writer") throw new Error("Viewer users cannot mutate Amazon imports.");
}

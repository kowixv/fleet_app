import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { projectionRpcItems } from "./projection-apply";

describe("projection RPC contract", () => {
  it("sends both new and unchanged eligible items in deterministic fingerprint order", () => {
    const items = projectionRpcItems({
      toCreate: [{ sourceFingerprint: "b", value: "new" }],
      unchanged: [{ sourceFingerprint: "a", value: "unchanged" }],
    });

    expect(items).toEqual([
      { sourceFingerprint: "a", value: "unchanged" },
      { sourceFingerprint: "b", value: "new" },
    ]);
  });

  it("qualifies pgcrypto digest and validates the same reduced preview metadata", () => {
    const migration = readFileSync(
      "supabase/migrations/20260719010000_fix_amazon_projection_digest_contract.sql",
      "utf8",
    );

    expect(migration).toContain("extensions.digest(payload, 'sha256'::text)");
    expect(migration).toContain("item->>'sourceFingerprint'");
    expect(migration).toContain("item->>'sourceRevision'");
    expect(migration).toContain("public.amazon_projection_preview_revision(p_items)");
    expect(migration).not.toContain("digest(coalesce(p_items::text");
  });

  it("rejects authenticated cross-organization projection requests", () => {
    const migration = readFileSync(
      "supabase/migrations/20260719010000_fix_amazon_projection_digest_contract.sql",
      "utf8",
    );

    expect(migration).toContain("v_org is distinct from v_current_org");
    expect(migration).toContain("not (select public.is_org_writer())");
  });
});

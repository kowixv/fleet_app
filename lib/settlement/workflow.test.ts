import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ELIGIBLE_LOAD_STATUSES,
  canTransitionSettlementStatus,
  displayedCalculationReconciles,
  expenseAppliesToUsageGroup,
  activeUsageGroupsBlockedBy,
  usageGroupForSettlementType,
  validateInclusivePeriod,
  validatePercentFraction,
} from "./workflow";
import { computeSettlement } from "./engine";
import { STALE_SETTLEMENT_PREVIEW_MESSAGE, stableSettlementRevision } from "./revision";

const migration = readFileSync("supabase/migrations/20260714050000_settlement_workflow_hardening.sql", "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");
const actions = readFileSync("app/(app)/settlements/actions.ts", "utf8");
const form = readFileSync("components/SettlementForm.tsx", "utf8");
const settingsPage = readFileSync("app/(app)/settlements/settings/page.tsx", "utf8");
const settingsManager = readFileSync("components/SettlementSettingsManager.tsx", "utf8");
const sidebar = readFileSync("components/Sidebar.tsx", "utf8");
const pdfRoute = readFileSync("app/api/settlements/[id]/pdf/route.ts", "utf8");
const statement = readFileSync("lib/pdf/statement.tsx", "utf8");
const botExecutor = readFileSync("lib/bot-executor.ts", "utf8");
const supabaseServer = readFileSync("lib/supabase/server.ts", "utf8");
const revisionSource = readFileSync("lib/settlement/revision.ts", "utf8");
const sharedSettlementCreator = readFileSync("lib/settlement/create-from-selection.ts", "utf8");

describe("settlement workflow business rules", () => {
  it("maps settlement types to accounting usage lanes", () => {
    expect(usageGroupForSettlementType("company_driver")).toBe("driver");
    expect(usageGroupForSettlementType("box_truck_driver")).toBe("driver");
    expect(usageGroupForSettlementType("owner_operator")).toBe("owner");
    expect(usageGroupForSettlementType("managed_investor")).toBe("investor");
    expect(usageGroupForSettlementType("external_carrier_statement")).toBeNull();
  });

  it("allows a load once in driver and once in owner/investor lanes, not twice in one lane", () => {
    expect(migration).toContain("settlement_load_links_active_usage_key");
    expect(migration).toContain("case when usage_group in ('owner','investor') then 'asset_owner'");
    expect(migration).toContain("where released_at is null");
    expect(migration).toContain("company_driver");
    expect(migration).toContain("box_truck_driver");
    expect(migration).toContain("then 'driver'");
  });

  it("treats owner and investor as one mutually exclusive asset-owner lane", () => {
    expect(activeUsageGroupsBlockedBy("driver")).toEqual(["driver"]);
    expect(activeUsageGroupsBlockedBy("owner")).toEqual(["owner", "investor"]);
    expect(activeUsageGroupsBlockedBy("investor")).toEqual(["owner", "investor"]);
    expect(actions).toContain("activeUsageGroupsBlockedBy(usageGroup)");
    expect(botExecutor).toContain("activeUsageGroupsBlockedBy(usageGroup)");
  });

  it("also prevents duplicate active drafts for the same vehicle/payee/period shape", () => {
    expect(migration).toContain("settlements_active_vehicle_payee_period_key");
    expect(migration).toContain("where status <> 'void' and settlement_type <> 'external_carrier_statement'");
    expect(migration).toContain("settlements_active_external_carrier_period_key");
  });

  it("allows multiple date-less external carrier statements while preventing dated duplicates", () => {
    for (const source of [migration, schema]) {
      const match = source.match(/drop index if exists settlements_active_external_carrier_period_key;[\s\S]*?where status <> 'void'[\s\S]*?week_end is not null;/);
      expect(match?.[0]).toBeTruthy();
      const externalCarrierIndex = match![0];
      expect(externalCarrierIndex).toContain("create unique index settlements_active_external_carrier_period_key");
      expect(externalCarrierIndex).toContain("external_carrier_id");
      expect(externalCarrierIndex).toContain("week_start");
      expect(externalCarrierIndex).toContain("week_end");
      expect(externalCarrierIndex).toContain("external_carrier_id is not null");
      expect(externalCarrierIndex).toContain("week_start is not null");
      expect(externalCarrierIndex).toContain("week_end is not null");
      expect(externalCarrierIndex).not.toContain("coalesce");
    }
  });

  it("applies equivalent same-lane protection to expenses", () => {
    expect(migration).toContain("settlement_expense_links_active_usage_key");
    expect(migration).toContain("expense_id");
    expect(migration).toContain("case when usage_group in ('owner','investor') then 'asset_owner'");
  });

  it("void releases active usage without deleting historical links", () => {
    expect(migration).toContain("released_at = now()");
    expect(migration).toContain("released_reason = btrim(p_void_reason)");
    expect(migration).toContain("guard_settlement_link_release");
    expect(migration).toContain("Released settlement links cannot be reactivated.");
    expect(migration).toContain("status = p_new_status");
    expect(actions).toContain("voidSettlement");
    expect(actions).toContain("Void reason is required");
  });

  it("draft deletion is delegated to one guarded database function", () => {
    expect(migration).toContain("create or replace function delete_draft_settlement");
    expect(migration).toContain("v_status not in ('draft','pending_review')");
    expect(actions).toContain('supabase.rpc("delete_draft_settlement"');
    expect(actions).not.toContain('from("loads").update({ settlement_id: null })');
  });

  it("preserves and backfills legacy settlement_id without making it authoritative", () => {
    expect(migration).toContain("Legacy single-settlement pointer retained for compatibility");
    expect(migration).toContain("insert into settlement_load_links");
    expect(migration).toContain("join settlements s on s.organization_id = l.organization_id and s.id = l.settlement_id");
    expect(actions).not.toContain('.is("settlement_id", null)');
    expect(botExecutor).not.toContain('.is("settlement_id", null)');
    expect(actions).not.toContain('"booked"');
    expect(botExecutor).not.toContain('"booked"');
  });

  it("uses delivered and paid loads only", () => {
    expect([...ELIGIBLE_LOAD_STATUSES]).toEqual(["delivered", "paid"]);
    expect(actions).toContain("ELIGIBLE_LOAD_STATUSES");
    expect(migration).toContain("status in ('delivered','paid')");
  });

  it("targets expenses by accounting lane and permits universal expenses", () => {
    expect(expenseAppliesToUsageGroup({}, "driver")).toBe(true);
    expect(expenseAppliesToUsageGroup({ deduct_from_driver: true }, "driver")).toBe(true);
    expect(expenseAppliesToUsageGroup({ deduct_from_driver: true }, "owner")).toBe(false);
    expect(expenseAppliesToUsageGroup({ deduct_from_owner: true }, "owner")).toBe(true);
    expect(expenseAppliesToUsageGroup({ deduct_from_investor: true }, "investor")).toBe(true);
  });

  it("enforces the strict status state machine", () => {
    expect(canTransitionSettlementStatus("draft", "pending_review")).toBe(true);
    expect(canTransitionSettlementStatus("draft", "finalized")).toBe(true);
    expect(canTransitionSettlementStatus("finalized", "paid")).toBe(true);
    expect(canTransitionSettlementStatus("paid", "void")).toBe(true);
    expect(canTransitionSettlementStatus("void", "paid")).toBe(false);
    expect(canTransitionSettlementStatus("paid", "pending_review")).toBe(false);
    expect(canTransitionSettlementStatus("finalized", "draft")).toBe(false);
    expect(migration).toContain("guard_settlement_financial_lock");
  });

  it("validates percentages and inclusive date ranges", () => {
    expect(validatePercentFraction(0, "rate")).toBe(0);
    expect(validatePercentFraction(1, "rate")).toBe(1);
    expect(() => validatePercentFraction(1.01, "rate")).toThrow(/between/);
    expect(() => validateInclusivePeriod("2026-07-14", "2026-07-13")).toThrow(/before/);
  });

  it("every displayed calculation reconciles for all supported models", () => {
    const base = {
      companyFeePct: 0.1,
      driverPayPct: 0.3,
      externalCarrierFeePct: 0.12,
      managementCommission: { type: "flat" as const, amount: 25 },
    };
    for (const settlementType of ["company_driver", "box_truck_driver", "owner_operator", "managed_investor"] as const) {
      const result = computeSettlement({
        config: { ...base, settlementType },
        loads: [{ grossAmount: 1000.333 }],
        expenses: [{ category: "fuel", amount: 75.115 }],
      });
      expect(displayedCalculationReconciles(result)).toBe(true);
    }
    expect(displayedCalculationReconciles(computeSettlement({
      config: { ...base, settlementType: "external_carrier_statement", driverPayPct: null, managementCommission: { type: "flat", amount: 25, onlyIfPositiveBase: true } },
      externalNetPay: 500,
    }))).toBe(true);
  });
});

describe("settlement preview revisions", () => {
  const baseRevisionPayload = {
    business: {
      settlement_type: "owner_operator",
      usage_group: "owner",
      vehicle_id: "vehicle-1",
      owner_id: "owner-1",
      week_start: "2026-07-06",
      week_end: "2026-07-12",
    },
    overrides: {
      driverPayPct: null,
      companyFeePct: null,
      commissionAmount: null,
    },
    config: {
      settlement_type: "owner_operator",
      company_fee_pct: 0.12,
      management_commission_amount: 250,
    },
    selectedLoads: [{
      id: "load-1",
      vehicle_id: "vehicle-1",
      status: "delivered",
      delivery_date: "2026-07-07",
      gross_amount: 1200,
      total_miles: 320,
    }],
    selectedExpenses: [{
      id: "expense-1",
      vehicle_id: "vehicle-1",
      date: "2026-07-08",
      category: "fuel",
      amount: 300,
      deduct_from_settlement: true,
      deduct_from_owner: true,
    }],
    result: {
      grossRevenue: 1200,
      totalDeductions: 300,
      ourCommissionEarned: 250,
      netPay: 650,
    },
  };

  function revisionWith(patch: Record<string, unknown>) {
    return stableSettlementRevision({ ...baseRevisionPayload, ...patch });
  }

  it("is stable, opaque, and order-independent for equivalent data", () => {
    const revision = stableSettlementRevision(baseRevisionPayload);
    expect(revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(stableSettlementRevision({
      result: baseRevisionPayload.result,
      selectedExpenses: baseRevisionPayload.selectedExpenses,
      selectedLoads: baseRevisionPayload.selectedLoads,
      config: baseRevisionPayload.config,
      overrides: baseRevisionPayload.overrides,
      business: baseRevisionPayload.business,
    })).toBe(revision);
  });

  it("invalidates when selected load IDs, financial values, or status change", () => {
    const original = stableSettlementRevision(baseRevisionPayload);
    expect(revisionWith({ selectedLoads: [{ ...baseRevisionPayload.selectedLoads[0], id: "load-2" }] })).not.toBe(original);
    expect(revisionWith({ selectedLoads: [{ ...baseRevisionPayload.selectedLoads[0], gross_amount: 1300 }] })).not.toBe(original);
    expect(revisionWith({ selectedLoads: [{ ...baseRevisionPayload.selectedLoads[0], status: "booked" }] })).not.toBe(original);
  });

  it("invalidates when expense targeting, config, overrides, or calculated result change", () => {
    const original = stableSettlementRevision(baseRevisionPayload);
    expect(revisionWith({ selectedExpenses: [{ ...baseRevisionPayload.selectedExpenses[0], deduct_from_owner: false }] })).not.toBe(original);
    expect(revisionWith({ config: { ...baseRevisionPayload.config, company_fee_pct: 0.15 } })).not.toBe(original);
    expect(revisionWith({ overrides: { ...baseRevisionPayload.overrides, commissionAmount: 300 } })).not.toBe(original);
    expect(revisionWith({ result: { ...baseRevisionPayload.result, netPay: 640 } })).not.toBe(original);
  });
});

describe("settlement implementation contracts", () => {
  it("adds same-org link tables, RLS, policies, and grants in schema and migration", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("create table if not exists settlement_load_links");
      expect(source).toContain("settlement_load_links_load_same_org_fk");
      expect(source).toContain("create table if not exists settlement_expense_links");
      expect(source).toContain("settlement_expense_links_expense_same_org_fk");
      expect(source).toContain("alter table settlement_load_links enable row level security");
      expect(source).toContain("and (select is_org_writer())");
    }
  });

  it("prevents arbitrary authenticated financial totals through the raw RPC", () => {
    expect(migration).toContain("revoke execute on function create_settlement_atomic");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("return create_settlement_with_links_atomic");
    expect(actions).not.toContain('supabase.rpc("create_settlement_atomic"');
    expect(botExecutor).not.toContain('rpc("create_settlement_atomic"');
    expect(actions).toContain("createSettlementWithLinksAtomic");
    expect(sharedSettlementCreator).toContain('service.rpc("create_settlement_with_links_atomic"');
    expect(botExecutor).toContain('rpc("create_settlement_with_links_atomic"');
    expect(actions).toContain("buildSettlementPreview(input, profile.organization_id)");
  });

  it("protects settlement configuration tables from viewer writes at RLS level", () => {
    for (const table of ["vehicles", "people", "settings", "companies", "external_carriers"]) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("drop policy if exists %I_rw");
    expect(migration).toContain("create policy %I_update");
    expect(migration).toContain("and (select is_org_writer())");
  });

  it("protects loads and expenses financial inputs from viewer writes at RLS level", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("foreach t in array array['vehicles','people','settings','companies','external_carriers','loads','expenses']");
      expect(source).toContain("create policy %I_insert");
      expect(source).toContain("create policy %I_update");
      expect(source).toContain("create policy %I_delete");
      expect(source).toContain("and (select is_org_writer())");
    }
  });

  it("prevents profile role escalation and organization reassignment at the database level", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("create or replace function guard_profile_security_update");
      expect(source).toContain("Profile organization cannot be changed.");
      expect(source).toContain("Only organization owners or admins can change profile roles.");
      expect(source).toContain("Users cannot promote themselves.");
      expect(source).toContain("create policy profiles_update_self");
      expect(source).toContain("create policy profiles_update_role_admin");
      expect(source).toContain("is_org_profile_admin()");
    }
  });

  it("preflights legacy backfill conflicts before creating active unique indexes", () => {
    expect(migration.indexOf("Legacy settlement load links conflict")).toBeLessThan(migration.indexOf("create unique index settlement_load_links_active_usage_key"));
    expect(migration.indexOf("Legacy settlement expense links conflict")).toBeLessThan(migration.indexOf("create unique index settlement_expense_links_active_usage_key"));
    expect(migration).toContain("Legacy settlement_id rows reference missing or cross-organization settlements");
  });

  it("requires server preview and create revalidation", () => {
    expect(actions).toContain("export async function previewSettlement");
    expect(actions).toContain("export async function createSettlementFromSelection");
    expect(actions.match(/buildSettlementPreview\(input, profile.organization_id\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(actions).toContain("staleLoadIds");
    expect(actions).toContain("preview_revision");
    expect(actions).toContain("stableSettlementRevision");
    expect(actions).toContain("STALE_SETTLEMENT_PREVIEW_MESSAGE");
    expect(actions).toContain("input.preview_revision !== preview.revision");
    expect(revisionSource).toContain(STALE_SETTLEMENT_PREVIEW_MESSAGE);
    expect(form).toContain("Preview Eligible Items");
    expect(form).toContain("Create Draft");
    expect(form).toContain("preview_revision: preview?.revision");
  });

  it("does not trust stored Telegram settlement totals at confirmation time", () => {
    expect(botExecutor).toContain("buildPreparedSettlement");
    expect(botExecutor).toContain("preview_revision");
    expect(botExecutor).toContain("selected_load_ids");
    expect(botExecutor).toContain("selected_expense_ids");
    expect(botExecutor).toContain("fresh.revision !== pending?.preview_revision");
    expect(botExecutor).toContain("...fresh.rpc");
    expect(botExecutor).not.toContain("payload?.rpc");
  });

  it("validates created_by profile organization in the service-only settlement RPC", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("p_created_by is not null");
      expect(source).toContain("from profiles where organization_id = p_organization_id and id = p_created_by");
      expect(source).toContain("Created-by profile does not belong to this organization.");
    }
  });

  it("keeps service-role Supabase helpers server-only", () => {
    expect(supabaseServer.startsWith('import "server-only";')).toBe(true);
    expect(supabaseServer).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(supabaseServer).not.toContain("NEXT_PUBLIC_SUPABASE_SERVICE");
  });

  it("keeps settlement defaults on the dedicated settings workflow", () => {
    expect(sidebar).toContain("/settlements/settings");
    expect(settingsPage).toContain("SettlementSettingsManager");
    expect(settingsManager).toContain('name="ownership_type"');
    expect(settingsManager).toContain('name="company_fee_pct"');
    expect(settingsManager).toContain('name="external_carrier_fee_pct"');
    expect(settingsManager).toContain('name="management_commission_amount"');
    expect(actions).toContain("saveVehicleSettlementConfig");
  });

  it("updates PDF rendering for linked rows and external carrier payees", () => {
    expect(pdfRoute).toContain("settlement_load_links");
    expect(pdfRoute).toContain("settlement_expense_links");
    expect(pdfRoute).toContain("external_carriers?.name");
    expect(statement).toContain("calculationRows");
    expect(statement).toContain("VOID / IPTAL");
  });
});

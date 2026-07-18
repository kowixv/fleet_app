import "server-only";

import { createClient } from "@/lib/supabase/server";
import { normalizeReferenceValue } from "../resolution/resolution-types";
import { safeProfileName } from "../ui-safe";
import type { ReferenceReviewCategory } from "../reference-review-validation";
import { requireAmazonImportActor } from "./auth";
import { throwAmazonUiReadError } from "./read-errors";

export type ReferenceReviewRole = "viewer" | "writer";
export type ReferenceTaskSeverity = "warning" | "blocking" | "info";

export interface ReferencePersonOption {
  id: string;
  label: string;
  type: string;
  status: string;
}

export interface ReferenceVehicleOption {
  id: string;
  unitNumber: string;
  description: string;
  status: string;
}

export interface ReferenceDependencySummary {
  kind: "revenue_item" | "fuel_group" | "statement_display" | "settlement";
  count: number;
  label: string;
}

export interface ReferenceReviewTask {
  id: string;
  category: ReferenceReviewCategory;
  issueCode: string;
  severity: ReferenceTaskSeverity;
  provider: "amazon" | "octane" | "manual" | "unknown";
  identifierType: string;
  safeExternalDisplay: string;
  affectedRevenueItems: number;
  affectedFuelGroups: number;
  effectiveDateRange: string;
  status: "open" | "resolved" | "dismissed";
  availableActions: string[];
  dependencySummaries: ReferenceDependencySummary[];
  impactPreview: {
    revenueItemsAffected: number;
    fuelGroupsAffected: number;
    readinessChanges: string[];
    statementDisplayDependencies: number;
    settlementDependencies: number;
  };
  placeholder: boolean;
  financialBlocked: boolean;
  sourceRevision: string | null;
  teamMemberCount: number;
}

export interface ReferenceReviewHistoryItem {
  id: string;
  category: ReferenceReviewCategory | "unknown";
  decisionType: string;
  status: "approved" | "rejected" | "archived" | "verified" | "recorded";
  reviewer: string;
  decidedAt: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  reason: string;
  safeSummary: string;
  supersededOrArchived: boolean;
}

export interface AmazonReferenceReviewView {
  batchId: string;
  batchStatus: string;
  period: string;
  role: ReferenceReviewRole;
  archived: boolean;
  canMutate: boolean;
  tasks: ReferenceReviewTask[];
  options: {
    people: ReferencePersonOption[];
    vehicles: ReferenceVehicleOption[];
  };
  counts: {
    totalRootIssues: number;
    blocking: number;
    warning: number;
    byCategory: Record<ReferenceReviewCategory, number>;
  };
  history: ReferenceReviewHistoryItem[];
}

type IssueRow = {
  id: string;
  issue_code: string;
  severity: string;
  message: string;
  details: Record<string, unknown> | null;
  status: string;
};

type BatchRow = {
  id: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
};

export async function getAmazonReferenceReviewForUi(batchId: string): Promise<AmazonReferenceReviewView | null> {
  const actor = await requireAmazonImportActor();
  const supabase = await createClient();
  const { data: batch, error: batchError } = await supabase
    .from("amazon_import_batches")
    .select("id, status, period_start, period_end")
    .eq("id", batchId)
    .maybeSingle();
  if (batchError) throwAmazonUiReadError("get_amazon_reference_review_batch", batchError);
  if (!batch) return null;

  const [
    issues,
    people,
    vehicles,
    history,
    fuelGroups,
    fuelReconciliation,
  ] = await Promise.all([
    supabase.from("amazon_import_issues").select("id, issue_code, severity, message, details, status").eq("batch_id", batchId).eq("status", "open"),
    supabase.from("people").select("id, full_name, type, status").eq("status", "active").order("full_name"),
    supabase.from("vehicles").select("id, unit_number, vehicle_type, year, make, model, status").in("status", ["active", "in_repair"]).order("unit_number"),
    supabase.from("amazon_import_review_decisions").select("id, decision_type, selected_value, reason, decided_at, reviewer:profiles!amazon_import_review_decisions_decided_by_same_org_fk(full_name)").eq("batch_id", batchId).order("decided_at", { ascending: false }).limit(100),
    supabase.from("fuel_import_card_groups").select("id, source_group_number, card_external_id, card_last_four, driver_label_raw, unit_label_raw, reported_transaction_count, reported_total_amount, is_placeholder_group, report:fuel_import_reports!fuel_import_card_groups_report_same_org_fk!inner(batch_id)").eq("report.batch_id", batchId),
    supabase.from("amazon_import_reconciliations").select("reconciliation_type, status").eq("batch_id", batchId),
  ]);
  for (const result of [issues, people, vehicles, history, fuelGroups, fuelReconciliation]) {
    if (result.error) throwAmazonUiReadError("get_amazon_reference_review", result.error);
  }
  const issueRows = (issues.data ?? []) as IssueRow[];
  const grouped = groupRootIssues(issueRows);
  const fuelRows = (fuelGroups.data ?? []) as Array<Record<string, unknown>>;
  const financialBlocked = (fuelReconciliation.data ?? []).some((row) =>
    row.reconciliation_type === "fuel_report" && row.status === "failed"
  );
  const tasks = [...grouped.entries()]
    .map(([rootKey, rows], index) => taskFromIssues({
      displayId: `task-${index + 1}`,
      rootKey,
      rows,
      fuelGroups: fuelRows,
      financialBlocked,
    }))
    .filter((task): task is ReferenceReviewTask => Boolean(task))
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.safeExternalDisplay.localeCompare(b.safeExternalDisplay));
  const counts = {
    totalRootIssues: tasks.length,
    blocking: tasks.filter((task) => task.severity === "blocking").length,
    warning: tasks.filter((task) => task.severity === "warning").length,
    byCategory: {
      driver: tasks.filter((task) => task.category === "driver").length,
      vehicle: tasks.filter((task) => task.category === "vehicle").length,
      facility: tasks.filter((task) => task.category === "facility").length,
      fuel_assignment: tasks.filter((task) => task.category === "fuel_assignment").length,
      team_split: tasks.filter((task) => task.category === "team_split").length,
    },
  };
  return {
    batchId,
    batchStatus: String((batch as BatchRow).status),
    period: formatPeriod((batch as BatchRow).period_start, (batch as BatchRow).period_end),
    role: actor.access,
    archived: String((batch as BatchRow).status) === "archived",
    canMutate: actor.access === "writer" && String((batch as BatchRow).status) !== "archived",
    tasks,
    options: {
      people: (people.data ?? []).map((row) => ({
        id: String(row.id),
        label: safeText(row.full_name, "Person"),
        type: safeText(row.type, "driver"),
        status: safeText(row.status, "active"),
      })),
      vehicles: (vehicles.data ?? []).map((row) => ({
        id: String(row.id),
        unitNumber: safeText(row.unit_number, "Unit"),
        description: [row.year, row.make, row.model, row.vehicle_type].filter(Boolean).map(String).join(" ") || "Vehicle",
        status: safeText(row.status, "active"),
      })),
    },
    counts,
    history: (history.data ?? []).map(historyItem),
  };
}

export async function getReferenceTaskForMutation(batchId: string, taskId: string) {
  const view = await getAmazonReferenceReviewForUi(batchId);
  if (!view) throw new Error("Amazon import batch was not found.");
  const task = view.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("Reference task is no longer available. Refresh and try again.");
  return { view, task };
}

export async function getReferenceTaskMutationContext(batchId: string, taskId: string) {
  const { view, task } = await getReferenceTaskForMutation(batchId, taskId);
  const supabase = await createClient();
  const { data: issues, error } = await supabase
    .from("amazon_import_issues")
    .select("id, issue_code, details")
    .eq("batch_id", batchId)
    .eq("status", "open");
  if (error) throw new Error(error.message);
  const sourceIssue = (issues ?? []).find((row) => {
    const details = asRecord(row.details);
    return issueCategory(String(row.issue_code ?? "")) === task.category
      && safeTaskDisplay(task.category, details, row.issue_code) === task.safeExternalDisplay;
  });
  const details = asRecord(sourceIssue?.details);
  const sourceGroupNumber = numberOrNull(details.sourceGroupNumber);
  const fuelCardValue = task.category === "fuel_assignment"
    ? await fuelCardValueForGroup(batchId, sourceGroupNumber)
    : null;
  return {
    view,
    task,
    issueId: sourceIssue ? String(sourceIssue.id) : null,
    provider: providerFromDetails(details, task.category),
    identifierType: identifierTypeFromDetails(details, task.category),
    externalValue: rawExternalValue(task.category, details, fuelCardValue),
    driverTokens: rawDriverTokens(details, task.teamMemberCount),
    facilityCode: rawExternalValue("facility", details, null),
  };
}

export async function resolveOpenIssuesForTask(batchId: string, task: ReferenceReviewTask): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("amazon_import_issues")
    .select("id, issue_code, details")
    .eq("batch_id", batchId)
    .eq("status", "open");
  if (error) throw new Error(error.message);
  const matchingIds = (data ?? [])
    .filter((row) => issueCategory(String(row.issue_code ?? "")) === task.category)
    .filter((row) => {
      const details = asRecord(row.details);
      return safeTaskDisplay(task.category, details, row.issue_code) === task.safeExternalDisplay;
    })
    .map((row) => String(row.id));
  if (matchingIds.length === 0) return 0;
  const { error: updateError } = await supabase
    .from("amazon_import_issues")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .in("id", matchingIds);
  if (updateError) throw new Error(updateError.message);
  return matchingIds.length;
}

export function taskMutationContext(task: ReferenceReviewTask) {
  return {
    provider: task.provider === "unknown" ? "manual" : task.provider,
    identifierType: task.identifierType,
    externalValue: task.safeExternalDisplay,
  };
}

async function fuelCardValueForGroup(batchId: string, sourceGroupNumber: number | null) {
  if (sourceGroupNumber == null) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fuel_import_card_groups")
    .select("card_external_id, source_group_number, report:fuel_import_reports!fuel_import_card_groups_report_same_org_fk!inner(batch_id)")
    .eq("report.batch_id", batchId)
    .eq("source_group_number", sourceGroupNumber)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.card_external_id === "string" ? data.card_external_id : null;
}

function groupRootIssues(rows: IssueRow[]) {
  const grouped = new Map<string, IssueRow[]>();
  for (const row of rows.filter((item) => isReferenceIssue(item.issue_code))) {
    const details = asRecord(row.details);
    const rootKey = String(details.rootIssueKey ?? details.issueKey ?? `${row.issue_code}:${safeTaskDisplay(issueCategory(row.issue_code), details, row.issue_code)}`);
    grouped.set(rootKey, [...(grouped.get(rootKey) ?? []), row]);
  }
  return grouped;
}

function taskFromIssues(args: {
  displayId: string;
  rootKey: string;
  rows: IssueRow[];
  fuelGroups: Array<Record<string, unknown>>;
  financialBlocked: boolean;
}): ReferenceReviewTask | null {
  const first = args.rows[0];
  if (!first) return null;
  const category = issueCategory(first.issue_code);
  if (!isReviewCategory(category)) return null;
  const details = asRecord(first.details);
  const sourceGroupNumber = numberOrNull(details.sourceGroupNumber);
  const fuelGroup = sourceGroupNumber == null
    ? null
    : args.fuelGroups.find((group) => Number(group.source_group_number) === sourceGroupNumber) ?? null;
  const affected = args.rows.length;
  const affectedFuelGroups = category === "fuel_assignment" ? Math.max(1, new Set(args.rows.map((row) => numberOrNull(asRecord(row.details).sourceGroupNumber))).size) : 0;
  const affectedRevenueItems = category === "fuel_assignment" ? 0 : affected;
  const placeholder = Boolean(fuelGroup?.is_placeholder_group ?? details.placeholderGroup);
  const display = category === "fuel_assignment" && fuelGroup
    ? fuelDisplay(fuelGroup)
    : safeTaskDisplay(category, details, first.issue_code);
  const severity = args.rows.some((row) => row.severity === "blocking") ? "blocking" : args.rows.some((row) => row.severity === "warning") ? "warning" : "info";
  const readinessChanges = category === "facility"
    ? ["statement display readiness"]
    : category === "fuel_assignment"
      ? ["fuel settlement deduction readiness"]
      : ["settlement readiness"];
  return {
    id: args.displayId,
    category,
    issueCode: first.issue_code,
    severity,
    provider: providerFromDetails(details, category),
    identifierType: identifierTypeFromDetails(details, category),
    safeExternalDisplay: display,
    affectedRevenueItems,
    affectedFuelGroups,
    effectiveDateRange: "Requires reviewed effective dates",
    status: "open",
    availableActions: availableActions(category, placeholder, args.financialBlocked),
    dependencySummaries: dependencySummaries(category, affectedRevenueItems, affectedFuelGroups),
    impactPreview: {
      revenueItemsAffected: affectedRevenueItems,
      fuelGroupsAffected: affectedFuelGroups,
      readinessChanges,
      statementDisplayDependencies: category === "facility" ? affected : 0,
      settlementDependencies: category === "facility" ? 0 : affected,
    },
    placeholder,
    financialBlocked: category === "fuel_assignment" && args.financialBlocked,
    sourceRevision: typeof details.sourceRevision === "string" ? details.sourceRevision : null,
    teamMemberCount: Array.isArray(details.driverTokens) ? details.driverTokens.length : 2,
  };
}

function isReferenceIssue(code: string) {
  const category = issueCategory(code);
  return isReviewCategory(category);
}

function isReviewCategory(category: string): category is ReferenceReviewCategory {
  return ["driver", "vehicle", "facility", "fuel_assignment", "team_split"].includes(category);
}

function issueCategory(code: string): ReferenceReviewCategory | "other" {
  if (code.includes("driver")) return "driver";
  if (code.includes("vehicle")) return "vehicle";
  if (code.includes("facility")) return "facility";
  if (code.includes("fuel_assignment") || code.includes("fuel_card") || code.includes("fuel")) return "fuel_assignment";
  if (code.includes("team")) return "team_split";
  return "other";
}

function safeTaskDisplay(category: ReferenceReviewCategory | "other", details: Record<string, unknown>, issueCode: unknown) {
  if (category === "driver") return limitText(textDetail(details, ["externalValue", "normalizedIdentifier", "driverToken", "driverLabel"]) ?? "Driver identifier");
  if (category === "vehicle") return maskIdentifier(textDetail(details, ["externalValue", "normalizedValue", "vehicleIdentifier", "unitLabel"]) ?? "Vehicle identifier");
  if (category === "facility") return maskIdentifier(textDetail(details, ["facilityCode", "normalizedCode", "normalizedFacilityCode"]) ?? "Facility code");
  if (category === "fuel_assignment") return maskIdentifier(textDetail(details, ["fuelCardValue", "cardExternalId", "groupIdentity"]) ?? String(issueCode ?? "Fuel group"));
  if (category === "team_split") return `Team of ${Array.isArray(details.driverTokens) ? details.driverTokens.length : 2} drivers`;
  return "Reference issue";
}

function rawExternalValue(category: ReferenceReviewCategory, details: Record<string, unknown>, fuelCardValue: string | null) {
  if (category === "driver") return textDetail(details, ["externalValue", "normalizedIdentifier", "driverToken", "driverLabel"]) ?? "";
  if (category === "vehicle") return textDetail(details, ["externalValue", "normalizedValue", "vehicleIdentifier", "unitLabel"]) ?? "";
  if (category === "facility") return textDetail(details, ["facilityCode", "normalizedCode", "normalizedFacilityCode"]) ?? "";
  if (category === "fuel_assignment") return fuelCardValue ?? textDetail(details, ["fuelCardValue", "cardExternalId", "groupIdentity"]) ?? "";
  return "";
}

function rawDriverTokens(details: Record<string, unknown>, count: number) {
  if (Array.isArray(details.driverTokens)) {
    return details.driverTokens.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  }
  const token = textDetail(details, ["externalValue", "normalizedIdentifier", "driverToken", "driverLabel"]);
  if (token) return [token];
  return Array.from({ length: Math.max(2, count) }, (_, index) => `TEAM_MEMBER_${index + 1}`);
}

function fuelDisplay(group: Record<string, unknown>) {
  const lastFour = typeof group.card_last_four === "string" && group.card_last_four ? group.card_last_four : null;
  if (lastFour) return `Fuel card ending ${lastFour}`;
  return `Fuel group ${Number(group.source_group_number ?? 0)}`;
}

function availableActions(category: ReferenceReviewCategory, placeholder: boolean, financialBlocked: boolean) {
  if (category === "fuel_assignment" && placeholder) return ["informational"];
  if (category === "fuel_assignment" && financialBlocked) return ["reject"];
  if (category === "vehicle") return ["approve", "archive"];
  if (category === "team_split") return ["approve", "archive"];
  return ["approve", "reject"];
}

function dependencySummaries(category: ReferenceReviewCategory, revenue: number, fuel: number): ReferenceDependencySummary[] {
  if (category === "fuel_assignment") return [{ kind: "fuel_group", count: fuel, label: "Fuel groups affected" }];
  return [
    { kind: "revenue_item", count: revenue, label: "Revenue items affected" },
    { kind: category === "facility" ? "statement_display" : "settlement", count: revenue, label: category === "facility" ? "Statement display dependencies" : "Settlement dependencies" },
  ];
}

function historyItem(row: Record<string, unknown>): ReferenceReviewHistoryItem {
  const selected = asRecord(row.selected_value);
  const decisionType = safeText(row.decision_type, "recorded");
  return {
    id: String(row.id),
    category: historyCategory(decisionType),
    decisionType,
    status: historyStatus(decisionType),
    reviewer: reviewer(row.reviewer),
    decidedAt: typeof row.decided_at === "string" ? row.decided_at : null,
    effectiveFrom: typeof selected.effectiveFrom === "string" ? selected.effectiveFrom : null,
    effectiveTo: typeof selected.effectiveTo === "string" ? selected.effectiveTo : null,
    reason: limitText(safeText(row.reason, "Recorded review decision"), 160),
    safeSummary: safeHistorySummary(decisionType, selected),
    supersededOrArchived: decisionType.includes("archive"),
  };
}

function safeHistorySummary(decisionType: string, selected: Record<string, unknown>) {
  if (decisionType.includes("driver")) return "Driver mapping decision";
  if (decisionType.includes("vehicle")) return "Vehicle alias decision";
  if (decisionType.includes("facility")) return "Facility verification decision";
  if (decisionType.includes("fuel")) return "Fuel assignment decision";
  if (decisionType.includes("team")) return "Team split decision";
  return selected.ruleId ? "Reference rule decision" : "Reference decision";
}

function historyCategory(decisionType: string): ReferenceReviewHistoryItem["category"] {
  if (decisionType.includes("driver")) return "driver";
  if (decisionType.includes("vehicle")) return "vehicle";
  if (decisionType.includes("facility")) return "facility";
  if (decisionType.includes("fuel")) return "fuel_assignment";
  if (decisionType.includes("team")) return "team_split";
  return "unknown";
}

function historyStatus(decisionType: string): ReferenceReviewHistoryItem["status"] {
  if (decisionType.includes("reject")) return "rejected";
  if (decisionType.includes("archive")) return "archived";
  if (decisionType.includes("verify")) return "verified";
  if (decisionType.includes("approve")) return "approved";
  return "recorded";
}

function providerFromDetails(details: Record<string, unknown>, category: ReferenceReviewCategory): ReferenceReviewTask["provider"] {
  const provider = textDetail(details, ["provider"]);
  if (provider === "amazon" || provider === "octane" || provider === "manual") return provider;
  return category === "fuel_assignment" ? "octane" : category === "facility" || category === "driver" || category === "vehicle" || category === "team_split" ? "amazon" : "unknown";
}

function identifierTypeFromDetails(details: Record<string, unknown>, category: ReferenceReviewCategory) {
  const identifierType = textDetail(details, ["identifierType", "identifier_type"]);
  if (identifierType) return identifierType;
  if (category === "driver") return "driver_display_name";
  if (category === "vehicle") return "tractor_vehicle_id";
  if (category === "facility") return "facility_code";
  if (category === "fuel_assignment") return "fuel_card";
  return "team_key";
}

function textDetail(details: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = details[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function safeText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function limitText(value: string, max = 48) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function maskIdentifier(value: string) {
  const normalized = normalizeReferenceValue(value) ?? "REFERENCE";
  if (normalized.length <= 4) return normalized;
  return `${normalized.slice(0, 2)}...${normalized.slice(-2)}`;
}

function numberOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function reviewer(value: unknown) {
  return safeProfileName(value);
}

function categoryRank(category: ReferenceReviewCategory) {
  return { driver: 1, vehicle: 2, facility: 3, fuel_assignment: 4, team_split: 5 }[category];
}

function formatPeriod(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return "No period";
  if (start === end) return start ?? "No period";
  return `${start ?? "open"} - ${end ?? "open"}`;
}

export type InspectionInputType = "pass_fail" | "checkbox" | "number" | "text" | "select";
export type FindingSeverity = "monitor" | "service_soon" | "critical" | "do_not_dispatch";

export interface InspectionTemplateItem {
  id: string;
  section: string;
  label: string;
  input_type: InspectionInputType;
  required: boolean;
  warning_threshold: number | null;
  critical_threshold: number | null;
  axle_position: string | null;
  unit_of_measure?: string | null;
  sort_order?: number | null;
}

export interface InspectionResultInput {
  template_item_id: string;
  value_text?: string | null;
  value_number?: number | null;
  value_bool?: boolean | null;
  passed?: boolean | null;
  notes?: string | null;
  photo_storage_path?: string | null;
}

export interface InspectionFindingDraft {
  severity: FindingSeverity;
  recommended_action: string;
}

const CRITICAL_PASS_FAIL_PATTERNS = [
  /tire bulge/i,
  /separation/i,
  /severe air leak/i,
  /hot\/leaking wheel end/i,
  /active severe derate/i,
  /coolant contamination/i,
];

const LOWER_IS_BAD_PATTERNS = [
  /brake/i,
  /tread/i,
  /battery cca/i,
  /regen frequency/i,
  /\bmpg\b/i,
];

export function resultHasValue(result: InspectionResultInput | undefined): boolean {
  if (!result) return false;
  return (
    (result.value_text != null && result.value_text.trim() !== "") ||
    result.value_number != null ||
    result.value_bool != null ||
    result.passed != null
  );
}

export function validateRequiredInspectionResults(
  items: InspectionTemplateItem[],
  results: InspectionResultInput[],
): string[] {
  const byItem = new Map(results.map((result) => [result.template_item_id, result]));
  return items
    .filter((item) => item.required && !resultHasValue(byItem.get(item.id)))
    .map((item) => item.label);
}

function lowerIsBad(label: string): boolean {
  return LOWER_IS_BAD_PATTERNS.some((pattern) => pattern.test(label));
}

export function classifyInspectionResult(
  item: Pick<InspectionTemplateItem, "label" | "input_type" | "warning_threshold" | "critical_threshold">,
  result: InspectionResultInput,
): InspectionFindingDraft | null {
  if (item.input_type === "pass_fail" && result.passed === false) {
    const severity: FindingSeverity = CRITICAL_PASS_FAIL_PATTERNS.some((pattern) => pattern.test(item.label))
      ? "do_not_dispatch"
      : "service_soon";
    return {
      severity,
      recommended_action:
        severity === "do_not_dispatch"
          ? "Do not dispatch until reviewed and repaired by authorized personnel."
          : "Schedule service and verify before next dispatch window.",
    };
  }

  if (result.value_number == null) return null;
  const critical = item.critical_threshold;
  const warning = item.warning_threshold;
  const value = Number(result.value_number);
  const isLowBad = lowerIsBad(item.label);
  if (critical != null && (isLowBad ? value <= critical : value >= critical)) {
    return {
      severity: "critical",
      recommended_action: "Create a repair/work-order draft and inspect before dispatch.",
    };
  }
  if (warning != null && (isLowBad ? value <= warning : value >= warning)) {
    return {
      severity: "service_soon",
      recommended_action: "Monitor and schedule service soon.",
    };
  }
  return null;
}

export function hasDoNotDispatchFinding(findings: Array<{ severity: FindingSeverity; status?: string | null }>): boolean {
  return findings.some(
    (finding) =>
      (finding.status == null || finding.status === "open") &&
      (finding.severity === "critical" || finding.severity === "do_not_dispatch"),
  );
}

export function cloneTemplateName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `${trimmed} Copy` : "Inspection Template Copy";
}

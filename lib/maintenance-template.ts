import { recommendWetPMInterval, type DutyCycle } from "./maintenance";
import { serviceKey } from "./maintenance-invoice-review";

export interface MaintenanceProfileSummary {
  vehicle_id: string;
  duty_cycle: DutyCycle;
  rolling_30_day_mpg: number | null;
  idle_percentage: number | null;
  engine_hours: number | null;
}

export interface MaintenanceTemplateItemSummary {
  id: string;
  service_type: string;
  service_category: string | null;
  description: string | null;
  default_checklist_reference: string | null;
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours: number | null;
  duty_cycle_adjusted: boolean;
  configurable: boolean;
  warning: string | null;
  sort_order: number;
}

export interface ExistingMaintenanceRuleSummary {
  id: string;
  vehicle_id: string;
  service_type: string;
  active: boolean;
}

export interface TemplatePreviewItem extends MaintenanceTemplateItemSummary {
  service_key: string;
  enabled: boolean;
  duplicate_rule_id: string | null;
  recommendation: string | null;
  recommendation_warning: string | null;
}

export function previewTemplateItems({
  items,
  existingRules,
  vehicleId,
  profile,
}: {
  items: MaintenanceTemplateItemSummary[];
  existingRules: ExistingMaintenanceRuleSummary[];
  vehicleId: string;
  profile: MaintenanceProfileSummary | null;
}): TemplatePreviewItem[] {
  const activeKeys = new Map(
    existingRules
      .filter((rule) => rule.active && rule.vehicle_id === vehicleId)
      .map((rule) => [serviceKey(rule.service_type), rule.id]),
  );

  return [...items]
    .sort((a, b) => a.sort_order - b.sort_order || a.service_type.localeCompare(b.service_type))
    .map((item) => {
      const key = serviceKey(item.service_type);
      const duplicate = activeKeys.get(key) ?? null;
      const wetPM = /wet pm|oil service/i.test(item.service_type)
        ? recommendWetPMInterval({
            dutyCycle: profile?.duty_cycle ?? null,
            rolling30DayMpg: profile?.rolling_30_day_mpg ?? null,
            idlePercentage: profile?.idle_percentage ?? null,
            currentIntervalMiles: item.interval_miles,
          })
        : null;
      return {
        ...item,
        service_key: key,
        enabled: duplicate == null,
        duplicate_rule_id: duplicate,
        recommendation: wetPM
          ? `${wetPM.label}: ${wetPM.minMiles.toLocaleString("en-US")}${
              wetPM.maxMiles === wetPM.minMiles ? "" : `-${wetPM.maxMiles.toLocaleString("en-US")}`
            } mi`
          : null,
        recommendation_warning: wetPM?.warning ?? null,
      };
    });
}

export function templateItemIntervalLabel(item: Pick<MaintenanceTemplateItemSummary, "interval_miles" | "interval_days" | "interval_engine_hours">): string {
  const parts = [];
  if (item.interval_miles != null) parts.push(`${Number(item.interval_miles).toLocaleString("en-US")} mi`);
  if (item.interval_days != null) parts.push(`${Number(item.interval_days).toLocaleString("en-US")} days`);
  if (item.interval_engine_hours != null) parts.push(`${Number(item.interval_engine_hours).toLocaleString("en-US")} engine hours`);
  return parts.join(" OR ") || "-";
}

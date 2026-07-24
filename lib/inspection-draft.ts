import type { InspectionResultInput, InspectionTemplateItem } from "@/lib/inspection";

export interface InspectionDraftPayload {
  inspection_date?: string | null;
  inspector: string | null;
  shop: string | null;
  notes: string | null;
  mark_rule_serviced: boolean;
  expected_updated_at: string | null;
  results: InspectionResultInput[];
}

function optionalText(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} metin olmalı.`);
  return value.trim() || null;
}

function optionalBoolean(value: unknown, label: string): boolean | null {
  if (value == null || value === "") return null;
  if (typeof value !== "boolean") throw new Error(`${label} boolean olmalı.`);
  return value;
}

function optionalNumber(value: unknown, label: string): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} geçerli sayı olmalı.`);
  return value;
}

function parseResult(value: unknown): InspectionResultInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Inspection sonucu geçersiz.");
  }
  const row = value as Record<string, unknown>;
  const templateItemId = optionalText(row.template_item_id, "Checklist satırı");
  if (!templateItemId) throw new Error("Checklist satırı gerekli.");
  return {
    template_item_id: templateItemId,
    value_text: optionalText(row.value_text, "Metin değeri"),
    value_number: optionalNumber(row.value_number, "Sayısal değer"),
    value_bool: optionalBoolean(row.value_bool, "Checkbox değeri"),
    passed: optionalBoolean(row.passed, "Pass/fail değeri"),
    notes: optionalText(row.notes, "Sonuç notu"),
    photo_storage_path: optionalText(row.photo_storage_path, "Dosya yolu"),
  };
}

export function parseInspectionDraftResults(results: unknown): InspectionResultInput[] {
  if (!Array.isArray(results)) throw new Error("Inspection sonuçları geçersiz.");
  return results.map(parseResult);
}

export function parseInspectionDraftPayload(payload: unknown): InspectionDraftPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Inspection taslağı geçersiz.");
  }
  const input = payload as Record<string, unknown>;
  if (!Array.isArray(input.results)) throw new Error("Inspection sonuçları gerekli.");
  const inspectionDate = optionalText(input.inspection_date, "Inspection tarihi");
  if (inspectionDate && !/^\d{4}-\d{2}-\d{2}$/.test(inspectionDate)) {
    throw new Error("Inspection tarihi geçersiz.");
  }
  const expectedUpdatedAt = optionalText(input.expected_updated_at, "Taslak sürümü");
  if (expectedUpdatedAt && !Number.isFinite(Date.parse(expectedUpdatedAt))) {
    throw new Error("Taslak sürümü geçersiz.");
  }
  return {
    inspection_date: inspectionDate,
    inspector: optionalText(input.inspector, "Inspector"),
    shop: optionalText(input.shop, "Shop"),
    notes: optionalText(input.notes, "Inspection notu"),
    mark_rule_serviced: optionalBoolean(input.mark_rule_serviced, "Servis işareti") ?? false,
    expected_updated_at: expectedUpdatedAt,
    results: parseInspectionDraftResults(input.results),
  };
}

export function emptyInspectionResult(item: Pick<InspectionTemplateItem, "id" | "input_type">): InspectionResultInput {
  return { template_item_id: item.id, passed: item.input_type === "pass_fail" ? true : null };
}

export function mergeInspectionDraftResults<T extends Pick<InspectionTemplateItem, "id" | "input_type">>(
  items: T[],
  saved: InspectionResultInput[],
): Record<string, InspectionResultInput> {
  const savedByItem = new Map(saved.map((result) => [result.template_item_id, result]));
  return Object.fromEntries(items.map((item) => {
    const existing = savedByItem.get(item.id);
    return [
      item.id,
      existing
        ? { ...emptyInspectionResult(item), ...existing, template_item_id: item.id }
        : emptyInspectionResult(item),
    ];
  }));
}

export function isLatestInspectionSave(sequence: number, latestSequence: number): boolean {
  return sequence === latestSequence;
}

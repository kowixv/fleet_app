export interface ExactLabelTarget {
  id: string;
  label: string | null;
}

export function compactExactLabel(value: string | null | undefined): string | null {
  const compact = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return compact || null;
}

export function exactLabelTargetIds(
  label: string | null | undefined,
  targets: ExactLabelTarget[],
): string[] {
  const normalizedLabel = compactExactLabel(label);
  if (!normalizedLabel) return [];
  return [...new Set(
    targets
      .filter((target) => compactExactLabel(target.label) === normalizedLabel)
      .map((target) => target.id)
      .filter(Boolean),
  )];
}

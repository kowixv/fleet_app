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

export function splitExactSourceLabels(value: string | null | undefined): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];

  const parts = raw
    .split(/\s*(?:\/|\||;|\+|&|\bAND\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);

  return [...new Set(parts.length > 0 ? parts : [raw])];
}

export function exactLabelTargetIds(
  label: string | null | undefined,
  targets: ExactLabelTarget[],
): string[] {
  const normalizedLabel = compactExactLabel(label);
  if (!normalizedLabel) return [];

  const exactIds = [...new Set(
    targets
      .filter((target) => compactExactLabel(target.label) === normalizedLabel)
      .map((target) => target.id)
      .filter(Boolean),
  )];
  if (exactIds.length > 0) return exactIds;

  return initialSurnameTargetIds(label, targets);
}

export function initialSurnameTargetIds(
  label: string | null | undefined,
  targets: ExactLabelTarget[],
): string[] {
  const source = nameSignature(label);
  if (!source) return [];

  return [...new Set(
    targets
      .filter((target) => {
        const candidate = nameSignature(target.label);
        return candidate !== null
          && candidate.firstInitial === source.firstInitial
          && candidate.surname === source.surname;
      })
      .map((target) => target.id)
      .filter(Boolean),
  )];
}

function nameSignature(value: string | null | undefined): { firstInitial: string; surname: string } | null {
  const tokens = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .match(/[A-Z0-9]+/g) ?? [];

  if (tokens.length < 2) return null;
  const first = tokens[0];
  const surname = tokens[tokens.length - 1];
  if (!first || !surname || surname.length < 2) return null;
  return { firstInitial: first[0], surname };
}

import type {
  AmazonStatementDeductionLine,
  AmazonStatementFuelLine,
  AmazonStatementType,
} from "./statement-view-model";

export interface GroupedFuelDisplayLine {
  line: AmazonStatementFuelLine;
  transactionIndex: number;
  firstInTransaction: boolean;
}

export function groupFuelLinesForDisplay(lines: AmazonStatementFuelLine[]): GroupedFuelDisplayLine[] {
  const groups = new Map<string, { firstOrder: number; lines: AmazonStatementFuelLine[] }>();

  for (const line of lines) {
    const key = fuelTransactionKey(line);
    const current = groups.get(key) ?? { firstOrder: line.displayOrder, lines: [] };
    current.firstOrder = Math.min(current.firstOrder, line.displayOrder);
    current.lines.push(line);
    groups.set(key, current);
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      firstOrder: group.firstOrder,
      date: group.lines.find((line) => line.date)?.date ?? "",
      invoice: group.lines.find((line) => line.invoice)?.invoice ?? "",
      lines: group.lines.slice().sort((a, b) => a.displayOrder - b.displayOrder || a.product.localeCompare(b.product)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.invoice.localeCompare(b.invoice) || a.firstOrder - b.firstOrder)
    .flatMap((group, transactionIndex) => group.lines.map((line, lineIndex) => ({
      line,
      transactionIndex,
      firstInTransaction: lineIndex === 0,
    })));
}

export function fuelTransactionKey(line: AmazonStatementFuelLine): string {
  return [line.date ?? "", line.invoice ?? "", line.merchant ?? "", line.location ?? ""].join("|");
}

export function normalizeDeductionLabel(line: AmazonStatementDeductionLine, statementType: AmazonStatementType): string {
  if (statementType === "managed_investor" && /^external carrier fee/i.test(line.label)) {
    return line.label.replace(/^external carrier fee/i, "Company fee");
  }
  return line.label;
}

export function deductionDisplayOrder(line: AmazonStatementDeductionLine): number {
  const value = `${line.type} ${line.label}`;
  if (/insurance/i.test(value)) return 10;
  if (/eld|safety|ifta/i.test(value)) return 20;
  if (/company fee|external carrier fee|percentage/i.test(value)) return 30;
  if (/driver pay|driver percentage/i.test(value)) return 35;
  return 38;
}

export function percentageCardLabels(statementType: AmazonStatementType): { en: string; tr: string } {
  if (statementType === "managed_investor") {
    return { en: "DRIVER + COMPANY FEE", tr: "SOFOR + SIRKET KESINTISI" };
  }
  if (statementType === "owner_operator") {
    return { en: "COMPANY FEE", tr: "SIRKET KESINTISI" };
  }
  return { en: "DRIVER PAY", tr: "SOFOR UCRETI" };
}

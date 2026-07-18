import {
  fuelIssue,
  fuelTransactionFingerprint,
  normalizeFuelLabel,
  normalizeFuelProduct,
  OCTANE_FUEL_PDF_PARSER,
  parseFuelDateTime,
  parseFuelMoney,
  parseFuelNumber,
  type FuelCardGroup,
  type FuelImportIssue,
  type FuelProductLine,
  type FuelReport,
  type FuelTransaction,
} from "../fuel/fuel-normalization";
import { buildFuelSchemaSignature } from "./fuel-schema-signature";

interface SourceLine {
  text: string;
  page: number;
  rowNumber: number;
}

interface MutableGroup extends FuelCardGroup {
  transactions: FuelTransaction[];
}

const DATE_TIME = /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2})\s+(\S+)\s+(.+)$/;
const GROUP_HEADER = /^(?:\S+\s+)?(\d+)\s+(?:\u00B7|-|\.)\s+(.+?)\s+(?:\u00B7|-|\.)\s+(\d+)\s+txn[s]?\b(.*)$/i;
const PRODUCT_TOKEN = /^(ULSD|DEFD|DEF|DSL|DIESEL|FUEL|FEES?)$/i;
const DEAL_TYPES = new Set(["CP", "ND", "RM"]);

export function parseOctaneFuelText(text: string): FuelReport {
  return parseOctaneFuelTextPages([text]);
}

export function parseOctaneFuelTextPages(pages: string[]): FuelReport {
  const lines = pages.flatMap((pageText, pageIndex) => String(pageText)
    .split(/\n/)
    .map((text, rowIndex) => ({ text: text.trim(), page: pageIndex + 1, rowNumber: rowIndex + 1 }))
    .filter((line) => line.text.length > 0));
  const issues: FuelImportIssue[] = [];
  const header = parseReportHeader(lines);
  const groups: MutableGroup[] = [];
  const groupsByNumber = new Map<number, MutableGroup>();
  let currentGroup: MutableGroup | null = null;
  let currentTransaction: FuelTransaction | null = null;
  let sourceLineOrder = 0;
  let inFuelSummary = false;
  let inDiscountSummary = false;

  for (const line of lines) {
    const groupHeader = parseGroupHeader(line);
    if (groupHeader) {
      const existingGroup = groupsByNumber.get(groupHeader.sourceGroupNumber);
      if (existingGroup) {
        existingGroup.sourcePageEnd = line.page;
        currentGroup = existingGroup;
      } else {
        currentGroup = groupHeader;
        groups.push(currentGroup);
        groupsByNumber.set(currentGroup.sourceGroupNumber, currentGroup);
      }
      currentTransaction = null;
      sourceLineOrder = currentGroup.transactions.reduce((count, transaction) => count + transaction.productLines.length, 0);
      inFuelSummary = false;
      inDiscountSummary = false;
      continue;
    }

    if (!currentGroup) continue;
    currentGroup.sourcePageEnd = line.page;

    if (/grand\s+total|report\s+total|all\s+cards/i.test(line.text)) {
      currentGroup = null;
      currentTransaction = null;
      inFuelSummary = false;
      inDiscountSummary = false;
      continue;
    }

    if (/^Fuel\s*&\s*Fees\b/i.test(line.text)) {
      inFuelSummary = true;
      inDiscountSummary = false;
      continue;
    }
    if (/^Discount\b/i.test(line.text)) {
      inFuelSummary = false;
      inDiscountSummary = true;
      continue;
    }
    if (inFuelSummary) {
      parseGroupFuelSummaryLine(currentGroup, line.text);
      continue;
    }
    if (inDiscountSummary) {
      parseGroupDiscountSummaryLine(currentGroup, line.text);
      continue;
    }

    const transactionParts = DATE_TIME.exec(line.text);
    if (transactionParts) {
      const parsedLine = parseFuelProductLine(transactionParts[4], sourceLineOrder + 1, line, issues);
      sourceLineOrder += 1;
      const parsedDate = parseFuelDateTime(transactionParts[1], transactionParts[2]);
      if (parsedDate.warning) {
        issues.push(fuelIssue(parsedDate.warning, "warning", "Fuel transaction date could not be normalized.", {
          sourcePage: line.page,
          sourceGroupNumber: currentGroup.sourceGroupNumber,
          sourceRowNumber: line.rowNumber,
          fieldPath: "transaction_at",
        }));
      }
      currentTransaction = {
        sourceTransactionFingerprint: "",
        transactionAt: parsedDate.value,
        invoiceNumber: cleanDash(transactionParts[3]),
        ...parseMerchantLocation(parsedLine.prefix),
        odometerRaw: null,
        feesAmount: null,
        sourcePage: line.page,
        sourceRowNumber: line.rowNumber,
        sourceSnapshot: { rawText: line.text },
        productLines: [parsedLine.line],
      };
      currentTransaction.sourceTransactionFingerprint = fuelTransactionFingerprint({
        provider: "octane",
        sourceGroupNumber: currentGroup.sourceGroupNumber,
        transactionAt: currentTransaction.transactionAt,
        invoiceNumber: currentTransaction.invoiceNumber,
        sourcePage: currentTransaction.sourcePage,
        sourceRowNumber: currentTransaction.sourceRowNumber,
        productLines: currentTransaction.productLines,
      });
      currentGroup.transactions.push(currentTransaction);
      continue;
    }

    if (PRODUCT_TOKEN.test(line.text.split(/\s+/)[0] ?? "")) {
      if (!currentTransaction) {
        issues.push(fuelIssue("orphan_product_line", "blocking", "Fuel product continuation row has no preceding transaction.", {
          sourcePage: line.page,
          sourceGroupNumber: currentGroup.sourceGroupNumber,
          sourceRowNumber: line.rowNumber,
        }));
        continue;
      }
      sourceLineOrder += 1;
      const parsedLine = parseFuelProductLine(line.text, sourceLineOrder, line, issues);
      currentTransaction.productLines.push(parsedLine.line);
      currentTransaction.sourceTransactionFingerprint = fuelTransactionFingerprint({
        provider: "octane",
        sourceGroupNumber: currentGroup.sourceGroupNumber,
        transactionAt: currentTransaction.transactionAt,
        invoiceNumber: currentTransaction.invoiceNumber,
        sourcePage: currentTransaction.sourcePage,
        sourceRowNumber: currentTransaction.sourceRowNumber,
        productLines: currentTransaction.productLines,
      });
    }
  }

  for (const group of groups) {
    group.isPlaceholderGroup = group.transactions.length === 0
      && (group.reportedTotalAmount === null || Math.abs(group.reportedTotalAmount) < 0.01);
  }

  const schemaSignature = buildFuelSchemaSignature("fuel_card", {
    titleDetected: lines.some((line) => /transaction report/i.test(line.text)),
    groupCount: groups.length,
    productColumns: ["item", "unit_prc", "disc_ppu", "qty", "disc_amt", "dt", "total"],
  });
  return {
    provider: "octane",
    carrierIdentifier: header.carrierIdentifier,
    periodStart: header.periodStart,
    periodEnd: header.periodEnd,
    generatedAt: null,
    reportedTransactionCount: header.reportedTransactionCount,
    reportedTotalAmount: header.reportedTotalAmount,
    reportedTotalQuantity: header.reportedTotalQuantity,
    reportedDiscountAmount: header.reportedDiscountAmount,
    reportedCardCount: header.reportedCardCount,
    parser: OCTANE_FUEL_PDF_PARSER,
    schemaSignature,
    sourceSnapshot: {
      pageCount: pages.length,
      lineCount: lines.length,
      anchors: ["Transaction Report", "Fuel & Fees", "Discount"],
    },
    cardGroups: groups,
    issues,
  };
}

function parseReportHeader(lines: SourceLine[]) {
  const joined = lines.slice(0, 20).map((line) => line.text).join("\n");
  const period = joined.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\s+[—-]\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/);
  const carrier = joined.match(/Carrier\s+([^\n·]+)/i);
  return {
    carrierIdentifier: carrier?.[1]?.trim() ?? null,
    periodStart: period ? parseFuelDateOnly(period[1]) : null,
    periodEnd: period ? parseFuelDateOnly(period[2]) : null,
    reportedTransactionCount: numberBeforeLabel(lines, /^Transactions$/i),
    reportedTotalAmount: moneyBeforeLabel(lines, /^Total Spent$/i),
    reportedDiscountAmount: moneyBeforeLabel(lines, /^Discount$/i),
    reportedCardCount: numberBeforeLabel(lines, /^Cards$/i),
    reportedTotalQuantity: numberBeforeLabel(lines, /^Qty$/i),
  };
}

function parseGroupHeader(line: SourceLine): MutableGroup | null {
  const match = GROUP_HEADER.exec(line.text);
  if (!match || /transactions/i.test(line.text)) return null;
  const sourceGroupNumber = Number(match[1]);
  if (!Number.isInteger(sourceGroupNumber)) return null;
  const cardFragment = cleanDash(match[2]);
  const rest = match[4] ?? "";
  const unit = rest.match(/(?:^|\s+(?:\u00B7|-|\.)\s*)Unit\s+(.+)$/i)?.[1]?.trim() ?? null;
  const idIndex = rest.search(/\s+(?:\u00B7|-|\.)\s*ID\b/i);
  const driverRaw = cleanDash((idIndex === -1 ? rest : rest.slice(0, idIndex)).replace(/^[\u00B7\s.-]+/, "").trim());
  return {
    sourceGroupNumber,
    cardExternalId: cardFragment,
    cardLastFour: cardFragment?.match(/(\d{4})\D*$/)?.[1] ?? null,
    driverLabelRaw: driverRaw,
    driverLabelNormalized: normalizeFuelLabel(driverRaw),
    unitLabelRaw: cleanDash(unit),
    unitLabelNormalized: normalizeFuelLabel(unit),
    reportedTransactionCount: Number(match[3]),
    reportedTotalAmount: null,
    reportedTotalQuantity: null,
    reportedDiscountAmount: null,
    isPlaceholderGroup: false,
    sourcePageStart: line.page,
    sourcePageEnd: line.page,
    sourceSnapshot: { rawText: line.text },
    transactions: [],
  };
}

function parseFuelProductLine(text: string, sourceLineOrder: number, line: SourceLine, issues: FuelImportIssue[]): { prefix: string; line: FuelProductLine } {
  const rawTokens = text.split(/\s+/).filter(Boolean);
  const productIndex = findProductTokenIndex(rawTokens);
  const productTypeRaw = productIndex === -1 ? null : rawTokens[productIndex];
  const prefix = productIndex === -1 ? "" : rawTokens.slice(0, productIndex).join(" ");
  const tokens = productIndex === -1 ? rawTokens : rawTokens.slice(productIndex + 1);
  const dealIndex = tokens.findIndex((token) => DEAL_TYPES.has(token.toUpperCase()));
  const dealType = dealIndex === -1 ? null : tokens[dealIndex].toUpperCase();
  const beforeDeal = dealIndex === -1 ? tokens.slice(0, -1) : tokens.slice(0, dealIndex);
  const afterDeal = dealIndex === -1 ? tokens.slice(-1) : tokens.slice(dealIndex + 1);
  const retailUnitPrice = parseFuelNumber(beforeDeal[0]);
  const chargedUnitPrice = parseFuelNumber(beforeDeal[1]);
  const discountPerUnit = parseFuelNumber(beforeDeal[2]);
  const quantity = parseFuelNumber(beforeDeal[3]);
  const discountAmount = beforeDeal.length >= 5 ? parseFuelMoney(beforeDeal[4]) : { value: null };
  const chargedAmount = parseFuelMoney(afterDeal[0]);
  for (const [fieldPath, parsed] of Object.entries({ retailUnitPrice, chargedUnitPrice, discountPerUnit, quantity, discountAmount, chargedAmount })) {
    if (parsed.warning) {
      issues.push(fuelIssue(parsed.warning, "warning", "Fuel numeric value could not be normalized.", {
        sourcePage: line.page,
        sourceGroupNumber: null,
        sourceRowNumber: line.rowNumber,
        fieldPath,
      }, { rawTextShape: redactSourceShape(text) }));
    }
  }
  if (chargedAmount.value === null && textHasNonZeroNumber(text)) {
    issues.push(fuelIssue("unparsed_nonzero_fuel_amount", "blocking", "Fuel product line has a non-zero amount that could not be parsed.", {
      sourcePage: line.page,
      sourceGroupNumber: null,
      sourceRowNumber: line.rowNumber,
      fieldPath: "charged_amount",
    }, { rawTextShape: redactSourceShape(text) }));
  }
  return {
    prefix,
    line: {
      sourceLineOrder,
      productTypeRaw,
      productTypeNormalized: normalizeFuelProduct(productTypeRaw),
      quantity: quantity.value,
      retailUnitPrice: retailUnitPrice.value,
      chargedUnitPrice: chargedUnitPrice.value,
      discountPerUnit: discountPerUnit.value,
      discountAmount: discountAmount.value,
      dealType,
      chargedAmount: chargedAmount.value,
      sourceSnapshot: { rawTextShape: redactSourceShape(text) },
    },
  };
}

function findProductTokenIndex(tokens: string[]): number {
  for (let index = 0; index < tokens.length; index += 1) {
    if (!PRODUCT_TOKEN.test(tokens[index])) continue;
    if (numericToken(tokens[index + 1]) && numericToken(tokens[index + 2]) && numericToken(tokens[index + 3])) {
      return index;
    }
  }
  return -1;
}

function numericToken(value: string | undefined): boolean {
  return typeof value === "string" && /^-?\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value);
}

function parseMerchantLocation(prefix: string): Pick<FuelTransaction, "merchantRaw" | "cityRaw" | "stateRaw"> {
  const tokens = prefix.split(/\s+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (/^[A-Z]{2}$/.test(tokens[i])) {
      return {
        merchantRaw: tokens.slice(0, Math.max(0, i - 1)).join(" ") || null,
        cityRaw: tokens[i - 1] ?? null,
        stateRaw: tokens[i],
      };
    }
  }
  return { merchantRaw: prefix || null, cityRaw: null, stateRaw: null };
}

function parseGroupFuelSummaryLine(group: MutableGroup, text: string) {
  const amountQuantity = text.match(/^Total Fuel\s+(\$?-?\d[\d,]*(?:\.\d+)?)\s+(-?\d[\d,]*(?:\.\d+)?|—|-)/i);
  if (amountQuantity) {
    group.reportedTotalQuantity = parseFuelNumber(amountQuantity[2]).value;
    return;
  }
  const totals = text.match(/^Totals\s+(\$?-?\d[\d,]*(?:\.\d+)?)/i);
  if (totals) {
    group.reportedTotalAmount = parseFuelMoney(totals[1]).value;
  }
}

function parseGroupDiscountSummaryLine(group: MutableGroup, text: string) {
  const totalDiscount = text.match(/^Total Discount\s+(\$?-?\d[\d,]*(?:\.\d+)?)/i);
  if (totalDiscount) {
    group.reportedDiscountAmount = parseFuelMoney(totalDiscount[1]).value;
  }
}

function numberBeforeLabel(lines: SourceLine[], label: RegExp): number | null {
  const index = lines.findIndex((line) => label.test(line.text));
  if (index <= 0) return null;
  return parseFuelNumber(lines[index - 1].text).value;
}

function moneyBeforeLabel(lines: SourceLine[], label: RegExp): number | null {
  const index = lines.findIndex((line) => label.test(line.text));
  if (index <= 0) return null;
  return parseFuelMoney(lines[index - 1].text).value;
}

function parseFuelDateOnly(value: string): string | null {
  return parseFuelDateTime(value, "00:00").value?.slice(0, 10) ?? null;
}

function cleanDash(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "—") return null;
  return cleaned;
}

function textHasNonZeroNumber(text: string): boolean {
  return /(^|\s)-?(?!0+(?:\.0+)?(?:\s|$))\d+(?:\.\d+)?/.test(text);
}

function redactSourceShape(text: string): string {
  return text
    .replace(/\b\d{4,}\b/g, "[num]")
    .replace(/\$?-?\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g, "[n]")
    .replace(/[A-Z0-9]{5,}/g, "[id]");
}

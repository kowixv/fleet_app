import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AmazonParserInput, AmazonSourceMetadata } from "../contracts";
import { parseMoneyStrict, parseDateOnly, parseDriverTokens } from "./normalization";
import { parsePaymentXlsx } from "./payment-xlsx";
import { selectAmazonStatementParser } from "./parser-registry";
import { parseTripsCsv } from "./trips-csv";
import { sha256Hex } from "./normalization";

function paymentWorkbookBytes(options: {
  reorder?: boolean;
  extra?: boolean;
  missing?: string;
  malformedMoney?: boolean;
  malformedDate?: boolean;
  empty?: boolean;
  mismatch?: boolean;
  duplicateLoad?: boolean;
  dangerousHeader?: boolean;
  sheetCount?: number;
  rowCount?: number;
  columnCount?: number;
  oversizedCell?: boolean;
} = {}): Uint8Array {
  if (options.empty) {
    return xlsxWorkbook([{ name: "Empty", rows: [] }]);
  }
  const summary: XlsxCell[][] = [
    ["Invoice Number", "INV-SYN"],
    ["Invoice Date", dateCell("2026-07-12")],
    ["Invoice Total", options.mismatch ? 999 : 300],
    ["Work Period", "2026-07-05 - 2026-07-11"],
    ["Payment Date", dateCell("2026-07-16")],
    ["Payment Status", "Paid"],
    ["SCAC", "SYN1"],
  ];
  let headers = [
    "Invoice Number",
    "Block ID",
    "Trip ID",
    "Load ID",
    "Start Date",
    "End Date",
    "Route",
    "Operator Type",
    "Equipment",
    "Distance (Mi)",
    "Item Type",
    "Program Type",
    "Base Rate",
    "Fuel Surcharge",
    "Tolls",
    "Detention",
    "TONU",
    "Others",
    "Gross Pay",
    "Comments",
  ];
  if (options.reorder) headers = ["Gross Pay", "Invoice Number", "Load ID", "Trip ID", "Item Type", "Base Rate", "Fuel Surcharge", "Tolls", "Detention", "TONU", "Others", "Start Date", "End Date", "Block ID", "Route", "Operator Type", "Equipment", "Distance (Mi)", "Program Type", "Comments"];
  if (options.extra) headers.push("Harmless Extra");
  if (options.dangerousHeader) headers.push("__proto__", "constructor", "prototype");
  if (options.oversizedCell) headers.push("Oversized");
  if (options.columnCount) headers = Array.from({ length: options.columnCount }, (_value, index) => `Column ${index + 1}`);
  if (options.missing) headers = headers.filter((header) => header !== options.missing);
  const row = (values: Record<string, XlsxCell | undefined>): XlsxCell[] => headers.map((header) => Object.prototype.hasOwnProperty.call(values, header) ? values[header] ?? null : null);
  const rows: XlsxCell[][] = [
    ["semantic preface"],
    headers,
    row({ "Invoice Number": "INV-SYN", "Trip ID": "TRIP-1", "Item Type": "TOUR - COMPLETED", "Start Date": dateCell("2026-07-05"), "End Date": dateCell("2026-07-06"), "Base Rate": 100, "Fuel Surcharge": 0, "Tolls": 0, "Detention": 0, "TONU": 0, "Others": 0, "Gross Pay": 100, "Distance (Mi)": 100, Oversized: options.oversizedCell ? "x".repeat(32) : null }),
    row({ "Invoice Number": "INV-SYN", "Trip ID": "TRIP-1", "Load ID": options.duplicateLoad ? "LOAD-2" : "LOAD-1", "Item Type": "LOAD - COMPLETED", "Start Date": options.malformedDate ? "02/03/2026" : dateCell("2026-07-05"), "End Date": dateCell("2026-07-05"), "Base Rate": 0, "Fuel Surcharge": 25, "Tolls": 5, "Detention": 0, "TONU": 0, "Others": 0, "Gross Pay": 30 }),
    row({ "Invoice Number": "INV-SYN", "Trip ID": "LOAD-2", "Load ID": "LOAD-2", "Item Type": "SINGLE LOAD - COMPLETED", "Start Date": dateCell("2026-07-07"), "End Date": dateCell("2026-07-07"), "Base Rate": options.malformedMoney ? "$12abc" : 150, "Fuel Surcharge": 20, "Tolls": 0, "Detention": -5, "TONU": 0, "Others": 5, "Gross Pay": 170 }),
    row({ "Item Type": "Total", "Gross Pay": 300 }),
  ];
  if (options.rowCount && options.rowCount > rows.length) {
    while (rows.length < options.rowCount) rows.push(row({ "Item Type": "Total" }));
  }
  const sheets = [
    { name: "Payment Summary", rows: summary },
    { name: "Payment Details", rows },
  ];
  if (options.sheetCount && options.sheetCount > sheets.length) {
    for (let i = sheets.length; i < options.sheetCount; i += 1) sheets.push({ name: `Extra ${i}`, rows: [["x"]] });
  }
  return xlsxWorkbook(sheets);
}

function paymentInput(bytes: Uint8Array): AmazonParserInput {
  const metadata: AmazonSourceMetadata = {
    sourceType: "amazon_payment",
    originalFilename: "synthetic-payment.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: bytes.byteLength,
    sha256Hash: sha256Hex(bytes),
  };
  return { bytes, metadata, parser: { name: "test", version: "0" } };
}

function tripsInput(csv: string): AmazonParserInput {
  const bytes = Buffer.from(csv, "utf8");
  return {
    bytes,
    metadata: {
      sourceType: "amazon_trips",
      originalFilename: "synthetic-trips.csv",
      mimeType: "text/csv",
      sizeBytes: bytes.byteLength,
      sha256Hash: sha256Hex(bytes),
    },
    parser: { name: "test", version: "0" },
  };
}

type XlsxCell = string | number | boolean | null | { dateSerial: number };

function dateCell(isoDate: string): { dateSerial: number } {
  return { dateSerial: Math.round((Date.parse(`${isoDate}T00:00:00.000Z`) - Date.UTC(1899, 11, 30)) / 86_400_000) };
}

function xlsxWorkbook(sheets: Array<{ name: string; rows: XlsxCell[][] }>): Uint8Array {
  const files = new Map<string, string>();
  files.set("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`);
  files.set("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  files.set("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
</workbook>`);
  files.set("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  files.set("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
</styleSheet>`);
  sheets.forEach((sheet, index) => files.set(`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet.rows)));
  return zipStore(files);
}

function worksheetXml(rows: XlsxCell[][]): string {
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => cellXml(cell, rowIndex + 1, columnIndex + 1)).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function cellXml(cell: XlsxCell, row: number, column: number): string {
  if (cell === null || cell === undefined) return "";
  const ref = `${columnName(column)}${row}`;
  if (typeof cell === "string") return `<c r="${ref}" t="inlineStr"><is><t>${xml(cell)}</t></is></c>`;
  if (typeof cell === "boolean") return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`;
  if (typeof cell === "object") return `<c r="${ref}" s="1"><v>${cell.dateSerial}</v></c>`;
  return `<c r="${ref}"><v>${cell}</v></c>`;
}

function columnName(index: number): string {
  let value = "";
  let current = index;
  while (current > 0) {
    current -= 1;
    value = String.fromCharCode(65 + (current % 26)) + value;
    current = Math.floor(current / 26);
  }
  return value;
}

function zipStore(files: Map<string, string>): Uint8Array {
  const entries: Array<{ name: Buffer; data: Buffer; crc: number; offset: number }> = [];
  const localParts: Buffer[] = [];
  let offset = 0;
  for (const [filename, content] of files) {
    const name = Buffer.from(filename, "utf8");
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    localParts.push(header, name, data);
    entries.push({ name, data, crc, offset });
    offset += header.length + name.length + data.length;
  }
  const centralParts: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.data.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt32LE(entry.offset, 42);
    centralParts.push(header, entry.name);
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

describe("amazon parser normalization", () => {
  it("strictly parses money and preserves null versus zero", () => {
    expect(parseMoneyStrict("$1,234.56").value).toBe(1234.56);
    expect(parseMoneyStrict("-$1,234.56").value).toBe(-1234.56);
    expect(parseMoneyStrict(0).value).toBe(0);
    expect(parseMoneyStrict(null).value).toBeNull();
    expect(parseMoneyStrict("$12abc").warning).toBe("money_malformed");
    expect(parseMoneyStrict(Number.POSITIVE_INFINITY).warning).toBe("money_not_finite");
  });

  it("parses date-only values without timezone shifting and rejects ambiguous dates", () => {
    expect(parseDateOnly("2026-07-05").value).toBe("2026-07-05");
    expect(parseDateOnly(46208).value).toBe("2026-07-05");
    expect(parseDateOnly("02/03/2026").warning).toBe("date_ambiguous");
    expect(parseDateOnly("2026-02-31").warning).toBe("date_invalid");
  });

  it("tokenizes semicolon-delimited drivers without assigning internal IDs", () => {
    expect(parseDriverTokens(" Driver A ; Driver B ; ").tokens).toEqual(["Driver A", "Driver B"]);
    expect(parseDriverTokens("Driver A ; Driver B").requiresTeamRule).toBe(true);
  });
});

describe("amazon payment xlsx parser", () => {
  it("extracts summary, details, classifications, lineage and reconciliation", async () => {
    const parsed = await parsePaymentXlsx(paymentInput(paymentWorkbookBytes()));
    expect(parsed.summary).toMatchObject({
      invoiceNumber: "INV-SYN",
      invoiceDate: "2026-07-12",
      invoiceTotal: 300,
      workPeriodStart: "2026-07-05",
      workPeriodEnd: "2026-07-11",
      paymentDate: "2026-07-16",
      paymentStatus: "Paid",
      carrierIdentifier: "SYN1",
    });
    expect(parsed.detailRows.map((row) => row.normalizedValues.rowClassification)).toEqual([
      "trip_parent",
      "load_child",
      "standalone_load",
      "non_financial",
    ]);
    expect(parsed.detailRows[0].sourceSheet).toBe("Payment Details");
    expect(parsed.detailRows[0].sourceRowNumber).toBe(3);
    expect(parsed.detailRows[0].normalizedValues.startDate).toBe("2026-07-05");
    expect(parsed.detailRows[0].sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.reconciliation).toMatchObject({
      totalParsedGrossPay: 300,
      validFinancialRowCount: 3,
      tripParentCount: 1,
      loadChildCount: 1,
      standaloneLoadCount: 1,
      differenceAmount: 0,
      reconciliationStatus: "passed",
    });
  });

  it("discovers reordered columns and reports harmless extras", async () => {
    const parsed = await parsePaymentXlsx(paymentInput(paymentWorkbookBytes({ reorder: true, extra: true })));
    expect(parsed.detailRows[0].normalizedValues.grossPay).toBe(100);
    expect((parsed.schemaInspection.extraColumns as string[])).toContain("harmless_extra");
    expect(parsed.schemaInspection.compatibilityStatus).toBe("warning");
  });

  it("reports missing columns, malformed money/date, duplicate Load IDs and mismatches", async () => {
    const missing = await parsePaymentXlsx(paymentInput(paymentWorkbookBytes({ missing: "Gross Pay" })));
    expect(missing.issues.some((issue) => issue.issueCode === "schema_missing_column")).toBe(true);
    const malformed = await parsePaymentXlsx(paymentInput(paymentWorkbookBytes({ malformedMoney: true, malformedDate: true, duplicateLoad: true, mismatch: true })));
    expect(malformed.detailRows.some((row) => row.warnings.some((warning) => warning.includes("money_malformed")))).toBe(true);
    expect(malformed.detailRows.some((row) => row.warnings.some((warning) => warning.includes("date_ambiguous")))).toBe(true);
    expect(malformed.issues.some((issue) => issue.issueCode === "payment_duplicate_load_id")).toBe(true);
    expect(malformed.reconciliation.reconciliationStatus).toBe("warning");
  });

  it("blocks malicious prototype headers without polluting Object.prototype", async () => {
    const parsed = await parsePaymentXlsx(paymentInput(paymentWorkbookBytes({ dangerousHeader: true })));
    expect(parsed.detailRows).toHaveLength(4);
    expect(parsed.detailRows[0].rawValues.__proto__).toBeUndefined();
    expect(parsed.detailRows[0].rawValues.constructor).toBeUndefined();
    expect(parsed.detailRows[0].rawValues.prototype).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("fails clearly for empty workbooks or missing sheets", async () => {
    const parsed = await parsePaymentXlsx(paymentInput(paymentWorkbookBytes({ empty: true })));
    expect(parsed.issues.some((issue) => issue.issueCode === "payment_summary_missing")).toBe(true);
    expect(parsed.issues.some((issue) => issue.issueCode === "payment_details_missing")).toBe(true);
  });

  it("rejects excessive or malformed workbooks with no partial normalized output", async () => {
    const cases = [
      { bytes: paymentWorkbookBytes({ sheetCount: 4 }), limits: { maxWorkbookSheetCount: 3 }, code: "payment_xlsx_sheet_limit_exceeded" },
      { bytes: paymentWorkbookBytes({ rowCount: 8 }), limits: { maxRowsPerSheet: 7 }, code: "payment_xlsx_row_limit_exceeded" },
      { bytes: paymentWorkbookBytes({ columnCount: 6 }), limits: { maxColumnsPerRow: 5 }, code: "payment_xlsx_column_limit_exceeded" },
      { bytes: paymentWorkbookBytes(), limits: { maxTotalCells: 10 }, code: "payment_xlsx_cell_limit_exceeded" },
      { bytes: paymentWorkbookBytes({ oversizedCell: true }), limits: { maxCellStringLength: 8 }, code: "payment_xlsx_cell_string_limit_exceeded" },
      { bytes: paymentWorkbookBytes(), limits: { maxTotalParsedStringBytes: 10 }, code: "payment_xlsx_string_total_limit_exceeded" },
      { bytes: Buffer.from("not an xlsx", "utf8"), limits: {}, code: "payment_xlsx_unreadable" },
    ];
    for (const entry of cases) {
      const parsed = await parsePaymentXlsx(paymentInput(entry.bytes), { limits: entry.limits });
      expect(parsed.detailRows).toHaveLength(0);
      expect(parsed.issues[0]?.issueCode).toBe(entry.code);
      expect(parsed.reconciliation.totalParsedGrossPay).toBe(0);
    }
  });

  it("returns a structured parser-timeout failure", async () => {
    const parsed = await parsePaymentXlsx(paymentInput(paymentWorkbookBytes()), { limits: { maxParserMs: 0 } });
    expect(parsed.detailRows).toHaveLength(0);
    expect(parsed.issues[0]?.issueCode).toBe("payment_xlsx_parser_timeout");
  });
});

describe("amazon trips csv parser", () => {
  const validCsv = [
    "Trip ID,Load ID,Driver Name,Tractor Vehicle ID,Trip Stage,Load Execution Status,Transit Operator Type,Facility Sequence,Estimate Distance,Estimated Cost,Equipment Type,Stop 1 Facility,Stop 1 Planned Arrival Date,Stop 1 Planned Arrival Time,Stop 2 Facility,Notes",
    "TRIP-1,LOAD-1,Driver A,UNIT-1,Completed,Completed,Single Driver,FAC1>FAC2,123.4,999.99,Van,FAC1,2026-07-05,08:30,FAC2,\"quoted, comma\"",
    "TRIP-2,LOAD-2,Driver B; Driver C,UNIT-2,Completed,Completed,Team Driver,FAC3>FAC4,50,100.00,Van,FAC3,2026-07-06,09:00,FAC4,\"multi\nline\"",
  ].join("\n");

  it("parses operational fields, BOM, quoted commas/newlines and team drivers", async () => {
    const parsed = await parseTripsCsv(tripsInput(`\uFEFF${validCsv}`));
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].normalizedValues).toMatchObject({
      tripId: "TRIP-1",
      loadId: "LOAD-1",
      driverTokens: ["Driver A"],
      tractorVehicleId: "UNIT-1",
      estimatedDistance: 123.4,
      estimatedCost: 999.99,
    });
    expect(parsed.rows[1].normalizedValues.driverTokens).toEqual(["Driver B", "Driver C"]);
    expect(parsed.rows[1].normalizedValues.requiresTeamAssignmentRule).toBe(true);
    expect(parsed.rows[0].rawValues.Notes).toBe("quoted, comma");
    expect(parsed.rows[1].rawValues.Notes).toBe("multi\nline");
    expect(parsed.rows[0].sourceRowNumber).toBe(2);
    expect(parsed.aggregate.teamRowCount).toBe(1);
  });

  it("handles reordered/extra columns and reports missing columns", async () => {
    const reordered = "Extra,Load ID,Trip ID,Tractor Vehicle ID,Driver Name\nx,LOAD-1,TRIP-1,UNIT-1,Driver A";
    const parsed = await parseTripsCsv(tripsInput(reordered));
    expect(parsed.rows[0].normalizedValues.tripId).toBe("TRIP-1");
    expect(parsed.schemaInspection.compatibilityStatus).toBe("warning");
    const missing = await parseTripsCsv(tripsInput("Trip ID,Load ID\nTRIP-1,LOAD-1"));
    expect(missing.issues.some((issue) => issue.issueCode === "schema_missing_column")).toBe(true);
  });

  it("reports duplicate Load IDs, blank drivers, malformed timestamps and empty CSV", async () => {
    const csv = [
      "Trip ID,Load ID,Driver Name,Tractor Vehicle ID,Stop 1 Planned Arrival Date,Stop 1 Planned Arrival Time",
      "TRIP-1,LOAD-1,,UNIT-1,2026-07-05,badtime",
      "TRIP-2,LOAD-1,Driver B,UNIT-2,2026-07-06,09:00",
    ].join("\n");
    const parsed = await parseTripsCsv(tripsInput(csv));
    expect(parsed.issues.some((issue) => issue.issueCode === "trips_duplicate_load_id")).toBe(true);
    expect(parsed.aggregate.blankDriverCount).toBe(1);
    expect(parsed.aggregate.malformedTimestampCount).toBe(1);
    const empty = await parseTripsCsv(tripsInput(""));
    expect(empty.issues.some((issue) => issue.issueCode === "csv_csv_empty")).toBe(true);
  });
});

describe("amazon parser registry", () => {
  it("selects supported parsers from declared source, extension and schema inspection", async () => {
    const input = paymentInput(paymentWorkbookBytes());
    const result = await selectAmazonStatementParser(input.metadata, input.bytes);
    expect(result.status).toBe("supported");
    if (result.status === "supported") expect(result.parser.identity.name).toBe("amazon-payment-xlsx");
  });

  it("returns unsupported when confidence is insufficient", async () => {
    const bytes = Buffer.from("not,a,payment\n1,2,3");
    const result = await selectAmazonStatementParser({
      sourceType: "amazon_payment",
      originalFilename: "synthetic.csv",
      mimeType: "text/csv",
      sizeBytes: bytes.byteLength,
      sha256Hash: sha256Hex(bytes),
    }, bytes);
    expect(result.status).toBe("unsupported");
  });

  it("keeps parsers independent from settlement and Supabase modules", async () => {
    const modules = await Promise.all([
      import("./payment-xlsx"),
      import("./trips-csv"),
      import("./parser-registry"),
    ]);
    expect(JSON.stringify(Object.keys(modules[0]))).not.toMatch(/settlement|supabase/i);
  });

  it("does not depend on the removed xlsx package", () => {
    const packageJson = readFileSync("package.json", "utf8");
    const packageLock = readFileSync("package-lock.json", "utf8");
    expect(packageJson).not.toContain('"xlsx"');
    expect(packageLock).not.toContain('"node_modules/xlsx"');
    expect(packageLock).not.toContain('"xlsx":');
  });
});

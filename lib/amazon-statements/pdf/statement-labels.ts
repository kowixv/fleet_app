import type { AmazonStatementLanguageMode, AmazonStatementType } from "./statement-view-model";

export type LabelKey =
  | "statementPeriod"
  | "grossRevenue"
  | "totalDeductions"
  | "netSettlement"
  | "fuelDetails"
  | "revenueDetails"
  | "calculationSummary"
  | "otherDeductions"
  | "teamAllocation"
  | "notes"
  | "companyAuthorization"
  | "payeeApproval"
  | "page"
  | "status"
  | "template"
  | "vehicle"
  | "payee"
  | "invoice"
  | "payment"
  | "distance"
  | "route"
  | "weight"
  | "amount"
  | "date"
  | "product"
  | "discount"
  | "quantity"
  | "chargedPpu"
  | "merchant"
  | "location";

const labels: Record<LabelKey, { en: string; tr: string }> = {
  statementPeriod: { en: "Statement Period", tr: "Hesap Donemi" },
  grossRevenue: { en: "Gross Revenue", tr: "Brut Gelir" },
  totalDeductions: { en: "Total Deductions", tr: "Toplam Kesintiler" },
  netSettlement: { en: "Net Settlement", tr: "Net Odeme" },
  fuelDetails: { en: "Fuel Details", tr: "Yakit Detaylari" },
  revenueDetails: { en: "Revenue Details", tr: "Gelir Detaylari" },
  calculationSummary: { en: "Calculation Summary", tr: "Hesap Ozeti" },
  otherDeductions: { en: "Deductions", tr: "Kesintiler" },
  teamAllocation: { en: "Team Allocation", tr: "Takim Paylasimi" },
  notes: { en: "Notes and Reconciliation", tr: "Notlar ve Mutabakat" },
  companyAuthorization: { en: "Company Authorization", tr: "Sirket Onayi" },
  payeeApproval: { en: "Payee Approval", tr: "Alici Onayi" },
  page: { en: "Page", tr: "Sayfa" },
  status: { en: "Status", tr: "Durum" },
  template: { en: "Template", tr: "Sablon" },
  vehicle: { en: "Vehicle / Unit", tr: "Arac / Unite" },
  payee: { en: "Payee", tr: "Alici" },
  invoice: { en: "Invoice", tr: "Fatura" },
  payment: { en: "Payment", tr: "Odeme" },
  distance: { en: "Distance", tr: "Mesafe" },
  route: { en: "Route", tr: "Guzergah" },
  weight: { en: "Weight", tr: "Agirlik" },
  amount: { en: "Amount", tr: "Tutar" },
  date: { en: "Date", tr: "Tarih" },
  product: { en: "Product", tr: "Urun" },
  discount: { en: "Discount", tr: "Indirim" },
  quantity: { en: "Quantity", tr: "Miktar" },
  chargedPpu: { en: "Charged PPU", tr: "Birim Fiyat" },
  merchant: { en: "Merchant", tr: "Isyeri" },
  location: { en: "Location", tr: "Konum" },
};

const typeTitles: Record<AmazonStatementType, { en: string; tr: string }> = {
  company_driver: { en: "Driver Statement", tr: "Surucu Hesabi" },
  box_truck_driver: { en: "Box Truck Driver Statement", tr: "Box Truck Surucu Hesabi" },
  owner_operator: { en: "Owner Operator Statement", tr: "Owner Operator Hesabi" },
  managed_investor: { en: "Owner / Investor Statement", tr: "Owner / Investor Hesabi" },
};

export function label(key: LabelKey, mode: AmazonStatementLanguageMode): string {
  const value = labels[key];
  if (mode === "en") return value.en;
  if (mode === "tr") return value.tr;
  return `${value.en} / ${value.tr}`;
}

export function statementTitle(type: AmazonStatementType, mode: AmazonStatementLanguageMode): string {
  const value = typeTitles[type];
  if (mode === "en") return value.en;
  if (mode === "tr") return value.tr;
  return `${value.en} / ${value.tr}`;
}

export function typeTerminology(type: AmazonStatementType) {
  if (type === "company_driver" || type === "box_truck_driver") {
    return { gross: "Driver Gross", pay: "Driver Pay", deductions: "Driver Deductions", net: "Net Driver Pay" };
  }
  if (type === "managed_investor") {
    return { gross: "Gross Revenue", pay: "Driver Cost", deductions: "Operating Expenses", net: "Net Owner Proceeds" };
  }
  return { gross: "Gross Revenue", pay: "Company Fee", deductions: "Operating Deductions", net: "Net Settlement" };
}

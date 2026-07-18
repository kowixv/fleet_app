import type { AmazonParserInput, AmazonSchemaInspection } from "../contracts";
import type { FuelCardGroup, FuelProductLine, FuelReport, FuelTransaction } from "../fuel/fuel-normalization";
import type { FuelReportReconciliation } from "../fuel/fuel-reconciliation";

export interface FuelSourceAdapter {
  inspectSchema(input: AmazonParserInput): Promise<AmazonSchemaInspection>;
  parseReport(input: AmazonParserInput): Promise<FuelReport>;
  parseCardGroups(report: FuelReport): FuelCardGroup[];
  parseTransactions(group: FuelCardGroup): FuelTransaction[];
  parseProductLines(transaction: FuelTransaction): FuelProductLine[];
  reconcile(report: FuelReport): FuelReportReconciliation;
}

export interface UnsupportedFuelSchemaResult {
  supported: false;
  issueCode: "unsupported_fuel_schema";
  message: string;
}

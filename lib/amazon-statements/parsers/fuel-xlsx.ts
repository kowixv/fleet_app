import type { AmazonParserInput, AmazonSchemaInspection } from "../contracts";
import { buildFuelSchemaSignature } from "./fuel-schema-signature";
import type { UnsupportedFuelSchemaResult } from "./fuel-adapter";

export const fuelXlsxUnsupportedResult: UnsupportedFuelSchemaResult = {
  supported: false,
  issueCode: "unsupported_fuel_schema",
  message: "Fuel XLSX imports require a real source sample before a parser can be enabled.",
};

export async function inspectFuelXlsxSchema(_input: AmazonParserInput): Promise<AmazonSchemaInspection> {
  return {
    signature: buildFuelSchemaSignature("fuel_card", { adapter: "fuel-xlsx", supported: false }),
    warnings: ["unsupported_fuel_schema"],
    details: { ...fuelXlsxUnsupportedResult },
  };
}

import { sha256Hex, stableJson } from "./normalization";
import { OCTANE_FUEL_PDF_PARSER } from "../fuel/fuel-normalization";
import type { JsonObject, SchemaSignature } from "../types";

export function buildFuelSchemaSignature(sourceType: "fuel_card", anchors: JsonObject): SchemaSignature {
  return {
    sourceType,
    parser: OCTANE_FUEL_PDF_PARSER,
    signature: sha256Hex(stableJson({ sourceType, parser: OCTANE_FUEL_PDF_PARSER, anchors })).slice(0, 32),
  };
}

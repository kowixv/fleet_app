import type { AmazonRevenueItem } from "../revenue/revenue-builder";
import { roundMoney } from "../parsers/normalization";
import { projectionRevision, projectionSourceFingerprint } from "./projection-revision";
import type { ProjectedLoadPayload, ResolvedProjectionReference, RevenueProjectionItem } from "./projection-types";

export function mapRevenueItemToLoadProjection(args: {
  item: AmazonRevenueItem;
  batchId?: string | null;
  references?: ResolvedProjectionReference;
  canonicalReady?: boolean;
  projectionReady?: boolean;
  settlementReady?: boolean;
}): RevenueProjectionItem {
  const item = args.item;
  const pickupLocation = formatFacility(args.references?.originFacility ?? null);
  const deliveryLocation = formatFacility(args.references?.destinationFacility ?? null);
  const route = pickupLocation && deliveryLocation ? `${pickupLocation} -> ${deliveryLocation}` : null;
  const load: ProjectedLoadPayload = {
    load_number: item.primaryLoadId ?? item.tripId,
    load_source: "amazon_relay",
    vehicle_id: args.references?.vehicleId ?? null,
    driver_id: args.references?.driverId ?? null,
    pickup_date: item.startDate,
    delivery_date: item.endDate,
    pickup_location: pickupLocation,
    delivery_location: deliveryLocation,
    route,
    gross_amount: roundMoney(item.grossAmount),
    fuel_surcharge: roundMoney(item.fuelSurchargeAmount),
    loaded_miles: item.distance,
    empty_miles: 0,
    total_miles: item.distance,
    status: "pending",
    notes: "Amazon Relay projection",
  };
  const sourceFingerprint = projectionSourceFingerprint([
    "amazon-revenue-load",
    item.id,
    item.sourceRevision,
    item.sources.map((source) => source.paymentRow.sourceFingerprint).sort(),
  ]);
  const projectionSnapshot = {
    tripId: item.tripId,
    primaryLoadId: item.primaryLoadId,
    groupingType: item.groupingType,
    groupingKey: item.groupingKey,
    sourceRevision: item.sourceRevision,
    sourceFingerprints: item.sources.map((source) => source.paymentRow.sourceFingerprint).sort(),
    amounts: {
      grossAmount: item.grossAmount,
      fuelSurchargeAmount: item.fuelSurchargeAmount,
      baseAmount: item.baseAmount,
      tollAmount: item.tollAmount,
      detentionAmount: item.detentionAmount,
      tonuAmount: item.tonuAmount,
      otherAmount: item.otherAmount,
    },
    route: {
      originResolved: Boolean(args.references?.originFacility),
      destinationResolved: Boolean(args.references?.destinationFacility),
    },
  };
  return {
    revenueItemId: item.id,
    batchId: args.batchId ?? null,
    sourceRevision: projectionRevision({ source: "revenue-load", sourceRevision: item.sourceRevision, load }),
    sourceFingerprint,
    canonicalItem: item,
    load,
    projectionSnapshot,
    canonicalReady: args.canonicalReady ?? item.reconciliationStatus === "passed",
    projectionReady: args.projectionReady ?? item.reconciliationStatus === "passed",
    settlementReady: args.settlementReady ?? false,
  };
}

function formatFacility(facility: { city: string; state: string } | null): string | null {
  if (!facility) return null;
  return `${facility.city}, ${facility.state}`;
}

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { matchPaymentTrips, type PaymentSourceRow, type TripSourceRow } from "../matching/payment-trip-matcher";
import { buildAmazonRevenueItems } from "../revenue/revenue-builder";
import type { AmazonWorkflowActor } from "./workflow-types";

export function matchPaymentTripSources(paymentRows: PaymentSourceRow[], tripRows: TripSourceRow[]) {
  return matchPaymentTrips(paymentRows, tripRows);
}

export function buildCanonicalRevenueFromMatches(args: Parameters<typeof buildAmazonRevenueItems>[0]) {
  return buildAmazonRevenueItems(args);
}

export async function loadPersistedPaymentTripRows(actor: AmazonWorkflowActor, batchId: string): Promise<{
  paymentRows: PaymentSourceRow[];
  tripRows: TripSourceRow[];
}> {
  const supabase = await createClient();
  const [payment, trips] = await Promise.all([
    supabase
      .from("amazon_payment_rows")
      .select("id, trip_id, load_id, row_classification, gross_amount, source_snapshot")
      .eq("organization_id", actor.organizationId)
      .eq("batch_id", batchId),
    supabase
      .from("amazon_trip_rows")
      .select("id, trip_id, load_id, raw_driver_text, tractor_external_id, source_snapshot")
      .eq("organization_id", actor.organizationId)
      .eq("batch_id", batchId),
  ]);
  if (payment.error) throw new Error(payment.error.message);
  if (trips.error) throw new Error(trips.error.message);
  return {
    paymentRows: (payment.data ?? []).map((row) => ({
      id: String(row.id),
      tripId: row.trip_id ?? null,
      loadId: row.load_id ?? null,
      rowClassification: row.row_classification,
      grossPay: Number(row.gross_amount ?? 0),
    })) as unknown as PaymentSourceRow[],
    tripRows: (trips.data ?? []).map((row) => ({
      id: String(row.id),
      tripId: row.trip_id ?? null,
      loadId: row.load_id ?? null,
      driverNameRaw: row.raw_driver_text ?? null,
      tractorVehicleId: row.tractor_external_id ?? null,
    })) as unknown as TripSourceRow[],
  };
}

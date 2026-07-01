/**
 * POST /api/tracking/location
 * Receives location updates from the tablet client.
 * Auth: tablet token (Authorization: Bearer <token>)
 *
 * Also accepts batch updates (offline queue flush):
 * Body: single LocationPayload OR { batch: LocationPayload[] }
 */

import { authenticateTablet } from "@/lib/tracking/tablet-auth";
import { processLocation } from "@/lib/tracking/process-location";
import type { LocationPayload } from "@/lib/tracking/types";

export const runtime = "nodejs";

// Exclude from auth middleware
export const dynamic = "force-dynamic";

function validatePayload(p: unknown): p is LocationPayload {
  if (!p || typeof p !== "object") return false;
  const obj = p as Record<string, unknown>;
  return (
    typeof obj.latitude === "number" &&
    typeof obj.longitude === "number" &&
    typeof obj.speed === "number" &&
    typeof obj.timestamp === "string" &&
    obj.latitude >= -90 && obj.latitude <= 90 &&
    obj.longitude >= -180 && obj.longitude <= 180 &&
    obj.speed >= 0
  );
}

export async function POST(req: Request) {
  const auth = await authenticateTablet(req);
  if (!auth.ok) {
    return new Response(auth.error, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Support single and batch payloads
  const payloads: LocationPayload[] = [];

  if (body && typeof body === "object" && "batch" in (body as object)) {
    const batch = (body as { batch: unknown[] }).batch;
    if (!Array.isArray(batch)) {
      return Response.json({ error: "batch must be an array" }, { status: 400 });
    }
    // Process oldest first (queue order), cap at 50
    for (const item of batch.slice(-50)) {
      if (validatePayload(item)) payloads.push(item);
    }
  } else {
    if (!validatePayload(body)) {
      return Response.json({ error: "Invalid payload" }, { status: 400 });
    }
    payloads.push(body);
  }

  if (payloads.length === 0) {
    return Response.json({ error: "No valid payloads" }, { status: 400 });
  }

  // Process in sequence (latest point wins for unit_locations upsert)
  let lastMode = 'offline';
  for (const payload of payloads) {
    const result = await processLocation(auth.unitId, auth.orgId, payload);
    lastMode = result.mode;
  }

  return Response.json({
    ok: true,
    mode: lastMode,
    processed: payloads.length,
  });
}

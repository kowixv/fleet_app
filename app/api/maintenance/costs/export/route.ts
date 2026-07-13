import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  filterMaintenanceCostRows,
  maintenanceCostRowsToCsv,
  type MaintenanceCostCategory,
  type MaintenanceCostRow,
  type PlannedFilter,
} from "@/lib/maintenance-cost";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await requireProfile();
  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const vehicleId = url.searchParams.get("vehicle");
  const category = url.searchParams.get("category") as MaintenanceCostCategory | null;
  const planned = url.searchParams.get("planned") as PlannedFilter | null;
  const shop = url.searchParams.get("shop");
  const status = url.searchParams.get("status");

  const supabase = await createClient();
  let query = supabase
    .from("maintenance_cost_fact_v")
    .select("*")
    .order("cost_date", { ascending: false })
    .limit(5000);
  if (start) query = query.gte("cost_date", start);
  if (end) query = query.lte("cost_date", end);
  if (vehicleId) query = query.eq("vehicle_id", vehicleId);
  if (category) query = query.eq("category", category);
  if (shop) query = query.eq("shop", shop);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const rows = filterMaintenanceCostRows((data ?? []) as unknown as MaintenanceCostRow[], {
    start,
    end,
    vehicleId,
    category,
    planned: planned ?? "all",
    shop,
    status,
  });
  return new Response(maintenanceCostRowsToCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="maintenance-costs-${start ?? "all"}-${end ?? "all"}.csv"`,
    },
  });
}

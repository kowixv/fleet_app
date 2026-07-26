import { requireProfile } from "@/lib/auth";
import {
  maintenanceCostRowsToCsv,
  type MaintenanceCostCategory,
  type MaintenanceCostFilters,
  type PlannedFilter,
} from "@/lib/maintenance-cost";
import { getAllMaintenanceCostRows } from "@/lib/maintenance/service";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await requireProfile();
  const url = new URL(request.url);
  const filters: MaintenanceCostFilters = {
    start: url.searchParams.get("start"),
    end: url.searchParams.get("end"),
    vehicleId: url.searchParams.get("vehicle"),
    category: url.searchParams.get("category") as MaintenanceCostCategory | null,
    planned: (url.searchParams.get("planned") as PlannedFilter | null) ?? "all",
    shop: url.searchParams.get("shop"),
    status: url.searchParams.get("status"),
  };

  try {
    const rows = await getAllMaintenanceCostRows(await createClient(), filters);
    return new Response(maintenanceCostRowsToCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="maintenance-costs-${filters.start ?? "all"}-${filters.end ?? "all"}.csv"`,
        "x-maintenance-row-count": String(rows.length),
        "x-maintenance-data-complete": "true",
      },
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "CSV export failed." },
      { status: 500 },
    );
  }
}

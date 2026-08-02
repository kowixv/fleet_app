import { summarizeMaintenanceProgramStatuses } from "@/lib/maintenance-program-presets";

export interface MaintenanceProgramBulkItem {
  preset_id: string;
  title: string;
  vehicle_id: string | null;
  vehicle_type: "truck" | "box_truck";
  service_type: string;
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours: number | null;
}

export interface MaintenanceProgramInstallItemResult {
  presetId: string;
  title: string;
  vehicleId?: string;
  unitNumber?: string;
  status: "created" | "skipped" | "failed";
  message: string;
}

export interface MaintenanceProgramInstallResult {
  ok: boolean;
  created: number;
  skipped: number;
  failed: number;
  results: MaintenanceProgramInstallItemResult[];
  error?: string;
}

export interface MaintenanceProgramRpcClient {
  rpc(
    name: "install_maintenance_program_bulk",
    args: { p_payload: { items: MaintenanceProgramBulkItem[] } },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

function parseResultItems(value: unknown): MaintenanceProgramInstallItemResult[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Toplu kurulum yanıtı geçersiz.");
  }
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.results)) throw new Error("Toplu kurulum sonuçları eksik.");
  return payload.results.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Toplu kurulum sonucu geçersiz.");
    }
    const row = item as Record<string, unknown>;
    const status = row.status;
    if (status !== "created" && status !== "skipped" && status !== "failed") {
      throw new Error("Toplu kurulum statusu geçersiz.");
    }
    return {
      presetId: typeof row.presetId === "string" ? row.presetId : "unknown",
      title: typeof row.title === "string" ? row.title : "Bakım",
      vehicleId: typeof row.vehicleId === "string" ? row.vehicleId : undefined,
      unitNumber: typeof row.unitNumber === "string" ? row.unitNumber : undefined,
      status,
      message: typeof row.message === "string" ? row.message : "-",
    };
  });
}

export function summarizeMaintenanceProgramInstall(
  results: MaintenanceProgramInstallItemResult[],
  error?: string,
): MaintenanceProgramInstallResult {
  return {
    ...summarizeMaintenanceProgramStatuses(results),
    results,
    ...(error ? { ok: false, error } : {}),
  };
}

export async function installMaintenanceProgramItems(
  client: MaintenanceProgramRpcClient,
  items: MaintenanceProgramBulkItem[],
  preflight: MaintenanceProgramInstallItemResult[] = [],
): Promise<MaintenanceProgramInstallResult> {
  if (items.length === 0) return summarizeMaintenanceProgramInstall(preflight);
  const response = await client.rpc("install_maintenance_program_bulk", { p_payload: { items } });
  if (response.error) {
    return summarizeMaintenanceProgramInstall([
      ...preflight,
      ...items.map((item) => ({
        presetId: item.preset_id,
        title: item.title,
        vehicleId: item.vehicle_id ?? undefined,
        status: "failed" as const,
        message: response.error?.message ?? "Toplu kurulum başarısız.",
      })),
    ], response.error.message);
  }
  try {
    return summarizeMaintenanceProgramInstall([...preflight, ...parseResultItems(response.data)]);
  } catch (error) {
    return summarizeMaintenanceProgramInstall(
      preflight,
      error instanceof Error ? error.message : "Toplu kurulum yanıtı okunamadı.",
    );
  }
}

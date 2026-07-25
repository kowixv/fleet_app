import MaintenanceNav from "@/components/MaintenanceNav";
import MaintenanceUnitDirectory from "@/components/maintenance/MaintenanceUnitDirectory";
import { loadMaintenanceUnitDirectory } from "@/lib/maintenance-unit-data";
import {
  type UnitAttentionFilter,
  type UnitOperationalFilter,
} from "@/lib/maintenance-unit-summary";

export const dynamic = "force-dynamic";

const OPERATIONAL_FILTERS = new Set<UnitOperationalFilter>([
  "all",
  "active",
  "in_repair",
  "yard_hometime",
  "archived",
]);
const ATTENTION_FILTERS = new Set<UnitAttentionFilter>([
  "all",
  "overdue",
  "due_now",
  "due_soon",
  "critical",
  "ok",
]);

function first(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : value ?? "");
}

export default async function MaintenanceUnitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedOperational = first(params.status) as UnitOperationalFilter;
  const requestedAttention = first(params.attention) as UnitAttentionFilter;
  const operationalStatus = OPERATIONAL_FILTERS.has(requestedOperational)
    ? requestedOperational
    : "all";
  const attentionStatus = ATTENTION_FILTERS.has(requestedAttention)
    ? requestedAttention
    : "all";
  const includeArchived =
    first(params.archived) === "1" || operationalStatus === "archived";
  const action = first(params.action);
  const detailTab =
    action === "mileage"
      ? "mileage"
      : action === "inspections"
        ? "inspections"
        : undefined;
  const directory = await loadMaintenanceUnitDirectory(includeArchived);

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />

      <header>
        <h2 className="text-lg font-semibold">Unit Bakım Görünümü</h2>
        <p className="mt-1 text-sm text-slate-500">
          Bir unit seçerek bakım özeti, hatırlatıcılar, geçmiş, inspection, maliyet ve mileage
          bilgilerini görüntüleyin.
        </p>
      </header>

      {detailTab && (
        <div className="rounded-xl border border-brand/20 bg-brand/5 px-4 py-3 text-sm text-brand-dark">
          {detailTab === "mileage"
            ? "Mileage güncellemek için bir unit seçin."
            : "Inspection başlatmak için bir unit seçin."}
        </div>
      )}

      <MaintenanceUnitDirectory
        units={directory.units}
        variant="full"
        includeArchived={includeArchived}
        initialQuery={first(params.q)}
        initialOperationalStatus={operationalStatus}
        initialAttentionStatus={attentionStatus}
        detailTab={detailTab}
      />
    </div>
  );
}

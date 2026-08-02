"use client";

import type { VehicleMaintenanceSetupResult } from "@/app/(app)/vehicles/maintenance-setup-actions";
import {
  estimateVehicleMaintenancePresetCount,
  type VehicleMaintenanceBaselineMode,
  type VehicleMaintenanceDefaults,
  type VehicleMaintenanceSetupMode,
} from "@/lib/vehicle-maintenance-setup";

export interface MaintenanceCopyVehicleOption {
  id: string;
  unitNumber: string;
  vehicleType: string;
}

export default function VehicleMaintenanceSetupSection({
  vehicleType,
  engineModel,
  defaults,
  copyVehicles,
  mode,
  baselineMode,
  sourceVehicleId,
  result,
  isPending,
  onModeChange,
  onBaselineModeChange,
  onSourceVehicleChange,
  onRetry,
}: {
  vehicleType: string;
  engineModel: string | null;
  defaults: VehicleMaintenanceDefaults;
  copyVehicles: MaintenanceCopyVehicleOption[];
  mode: VehicleMaintenanceSetupMode;
  baselineMode: VehicleMaintenanceBaselineMode;
  sourceVehicleId: string;
  result: VehicleMaintenanceSetupResult | null;
  isPending: boolean;
  onModeChange: (mode: VehicleMaintenanceSetupMode) => void;
  onBaselineModeChange: (mode: VehicleMaintenanceBaselineMode) => void;
  onSourceVehicleChange: (id: string) => void;
  onRetry: () => void;
}) {
  const supported = vehicleType === "truck" || vehicleType === "box_truck";
  const similarVehicles = copyVehicles.filter((vehicle) => vehicle.vehicleType === vehicleType);
  const basicCount = supported ? estimateVehicleMaintenancePresetCount(vehicleType, "basic", engineModel) : 0;
  const fullCount = supported ? estimateVehicleMaintenancePresetCount(vehicleType, "full", engineModel) : 0;

  return (
    <section className="space-y-4 rounded-lg border border-blue-100 bg-blue-50/40 p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Bakım Kurulumu</h3>
          <span className="badge bg-blue-100 text-blue-800">Yeni araç</span>
        </div>
        <p className="mt-1 text-xs text-slate-600">
          Araç kaydedildikten sonra uygun program kurulur. Mevcut type-level kurallar yeniden oluşturulmaz.
        </p>
      </div>

      <input type="hidden" name="maintenance_setup_mode" value={mode} />
      <input type="hidden" name="maintenance_baseline_mode" value={baselineMode} />
      <input type="hidden" name="maintenance_source_vehicle_id" value={sourceVehicleId} />

      <div className="grid gap-3 md:grid-cols-2">
        <SetupOption
          selected={mode === "basic"}
          disabled={!supported}
          title="Temel Bakım Paketi"
          badge="Önerilen"
          description={`${vehicleType === "box_truck" ? "Box Truck" : "Semi Truck"} için yaklaşık ${basicCount} temel bakım.`}
          onSelect={() => onModeChange("basic")}
        />
        <SetupOption
          selected={mode === "full"}
          disabled={!supported}
          title="Tam Bakım Programı"
          description={`Temel + full presetler; yaklaşık ${fullCount} bakım${vehicleType === "truck" ? ". Motor modeli eşleşirse motor-özel bakım da eklenir." : "."}`}
          onSelect={() => onModeChange("full")}
        />
        <SetupOption
          selected={mode === "copy"}
          disabled={!supported || similarVehicles.length === 0}
          title="Benzer Araçtan Kopyala"
          description={similarVehicles.length > 0
            ? "Yalnızca kaynak aracın aktif araç-özel kuralları kopyalanır."
            : "Aynı tipte uygun kaynak araç bulunmuyor."}
          onSelect={() => onModeChange("copy")}
        />
        <SetupOption
          selected={mode === "none"}
          title="Şimdilik Bakım Kurma"
          description="Araç oluşturulur; yeni bakım kuralı eklenmez ve mevcut global kurallar kurulum bekler."
          onSelect={() => onModeChange("none")}
        />
      </div>

      {mode === "copy" && (
        <div>
          <label className="label">Kaynak araç</label>
          <select
            className="input"
            value={sourceVehicleId}
            required
            onChange={(event) => onSourceVehicleChange(event.target.value)}
          >
            <option value="">Benzer araç seçin</option>
            {similarVehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>Unit {vehicle.unitNumber}</option>
            ))}
          </select>
        </div>
      )}

      {mode !== "none" && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-slate-900">Takip başlangıcı</h4>
          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
            <input
              type="radio"
              name="maintenance-baseline-choice"
              checked={baselineMode === "current"}
              onChange={() => onBaselineModeChange("current")}
              className="mt-0.5 accent-brand"
            />
            <span>
              <span className="block font-medium">Mevcut mileage, engine hours ve bugünden başlat</span>
              <span className="mt-0.5 block text-xs text-slate-500">Yalnızca takip baseline’ıdır; bakım yapılmış kaydı oluşturmaz.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
            <input
              type="radio"
              name="maintenance-baseline-choice"
              checked={baselineMode === "manual"}
              onChange={() => onBaselineModeChange("manual")}
              className="mt-0.5 accent-brand"
            />
            <span>
              <span className="block font-medium">Son bakım bilgilerini daha sonra gireceğim</span>
              <span className="mt-0.5 block text-xs text-slate-500">Eksik baseline bulunan bakımlar “Kurulum gerekli” görünür.</span>
            </span>
          </label>
        </div>
      )}

      {!defaults.automaticSetup && mode === "none" && (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">Organizasyon ayarında yeni araçlar için otomatik bakım kurulumu kapalı.</p>
      )}

      {result && (
        <div className={`rounded-lg border p-4 ${result.failed > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <p className="font-medium">Araç oluşturuldu.</p>
          <p className="mt-1 text-sm">
            {result.created} bakım oluşturuldu, {result.skipped} zaten mevcut olduğu için atlandı, {result.failed} başarısız oldu.
          </p>
          {result.results.filter((item) => item.status === "failed").map((item, index) => (
            <p key={`${item.presetId}-${item.vehicleId ?? index}`} className="mt-1 text-sm text-red-700">
              {item.title}: {item.message}
            </p>
          ))}
          {result.needsInformation.length > 0 && (
            <div className="mt-3 text-sm text-amber-900">
              <p className="font-medium">Ek bilgi gereken bakımlar</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {result.needsInformation.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
          {(!result.ok || result.failed > 0) && (
            <button type="button" className="btn-ghost mt-3 bg-white" disabled={isPending} onClick={onRetry}>
              {isPending ? "Yeniden deneniyor..." : "Bakım Kurulumunu Yeniden Dene"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function SetupOption({
  selected,
  disabled = false,
  title,
  description,
  badge,
  onSelect,
}: {
  selected: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  badge?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`rounded-lg border p-3 text-left transition ${
        selected ? "border-brand bg-white ring-1 ring-brand" : "border-slate-200 bg-white hover:border-blue-300"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span className="flex items-center gap-2">
        <span className="font-medium text-slate-900">{title}</span>
        {badge && <span className="badge bg-blue-100 text-blue-800">{badge}</span>}
      </span>
      <span className="mt-1 block text-xs text-slate-500">{description}</span>
    </button>
  );
}

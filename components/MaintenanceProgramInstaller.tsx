"use client";

import {
  installMaintenanceProgram,
  type MaintenanceProgramInstallResult,
  type MaintenanceProgramSelectionInput,
} from "@/app/(app)/maintenance/actions";
import {
  MAINTENANCE_PROGRAM_REFERENCES,
  MAINTENANCE_PROGRAM_VEHICLE_OPTIONS,
  engineModelMatchesRequirement,
  findExistingProgramReminder,
  formatMaintenanceProgramInterval,
  getMaintenanceProgramPresets,
  presetDefaultEnabled,
  presetWarning,
  type MaintenancePackageLevel,
  type MaintenanceProgramExistingRule,
  type MaintenanceProgramPreset,
  type MaintenanceProgramSection,
  type MaintenanceProgramVehicleType,
} from "@/lib/maintenance-program-presets";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

export interface MaintenanceProgramVehicle {
  id: string;
  unitNumber: string;
  vehicleType: string;
  engineModel: string | null;
}

interface IntervalDraft {
  miles: string;
  days: string;
  engineHours: string;
}

const SECTION_LABELS: Record<MaintenanceProgramSection, string> = {
  frequent: "Sık Kontroller",
  scheduled: "Düzenli Bakımlar",
  major: "Büyük Bakımlar",
};

function defaultDraft(preset: MaintenanceProgramPreset): IntervalDraft {
  return {
    miles: preset.intervalMiles == null ? "" : String(preset.intervalMiles),
    days: preset.intervalDays == null ? "" : String(preset.intervalDays),
    engineHours: preset.intervalEngineHours == null ? "" : String(preset.intervalEngineHours),
  };
}

function parseDraftValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function sameDraft(left: IntervalDraft, right: IntervalDraft): boolean {
  return left.miles === right.miles && left.days === right.days && left.engineHours === right.engineHours;
}

function existingInterval(rule: MaintenanceProgramExistingRule): string {
  return formatMaintenanceProgramInterval({
    intervalMiles: rule.interval_miles,
    intervalDays: rule.interval_days,
    intervalEngineHours: rule.interval_engine_hours,
  });
}

export default function MaintenanceProgramInstaller({
  vehicles,
  existingRules,
}: {
  vehicles: MaintenanceProgramVehicle[];
  existingRules: MaintenanceProgramExistingRule[];
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [vehicleType, setVehicleType] = useState<MaintenanceProgramVehicleType>("truck");
  const [packageLevel, setPackageLevel] = useState<MaintenancePackageLevel>("basic");
  const [engineChoice, setEngineChoice] = useState<"general" | "cummins_x15" | "paccar_mx">("general");
  const [engineVehicleIds, setEngineVehicleIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, IntervalDraft>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MaintenanceProgramInstallResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.vehicleType === vehicleType),
    [vehicleType, vehicles],
  );
  const hasEngineData = activeVehicles.some((vehicle) => Boolean(vehicle.engineModel?.trim()));
  const paccarVehicles = hasEngineData
    ? activeVehicles.filter((vehicle) => engineModelMatchesRequirement(vehicle.engineModel, "paccar_mx"))
    : activeVehicles;
  const presets = getMaintenanceProgramPresets(vehicleType, packageLevel, engineChoice === "paccar_mx");
  const references = MAINTENANCE_PROGRAM_REFERENCES.filter((item) => item.applicableVehicleTypes.includes(vehicleType));

  function openInstaller() {
    setOpen(true);
    setStep(1);
    setVehicleType("truck");
    setPackageLevel("basic");
    setEngineChoice("general");
    setEngineVehicleIds(new Set());
    setSelectedIds(new Set());
    setDrafts({});
    setConfirmed(false);
    setError("");
    setResult(null);
  }

  function chooseVehicleType(value: MaintenanceProgramVehicleType) {
    setVehicleType(value);
    setEngineChoice("general");
    setEngineVehicleIds(new Set());
    setPackageLevel("basic");
    setStep(2);
  }

  function prepareReview() {
    const nextSelected = new Set<string>();
    const nextDrafts: Record<string, IntervalDraft> = {};
    for (const preset of presets) {
      nextDrafts[preset.id] = defaultDraft(preset);
      const existing = preset.engineRequirement
        ? false
        : Boolean(findExistingProgramReminder(preset, existingRules, vehicleType));
      if (!existing && presetDefaultEnabled(preset, vehicleType)) nextSelected.add(preset.id);
    }
    setSelectedIds(nextSelected);
    setDrafts(nextDrafts);
    setConfirmed(false);
    setError("");
    setResult(null);
    setStep(3);
  }

  function togglePreset(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleEngineVehicle(id: string) {
    setEngineVehicleIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function patchDraft(id: string, patch: Partial<IntervalDraft>) {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? { miles: "", days: "", engineHours: "" }), ...patch } }));
  }

  function install() {
    setError("");
    setResult(null);
    if (!confirmed) {
      setError("Oluşturmadan önce son onayı işaretleyin.");
      return;
    }

    const selections: MaintenanceProgramSelectionInput[] = [];
    for (const preset of presets) {
      if (!selectedIds.has(preset.id)) continue;
      const draft = drafts[preset.id] ?? defaultDraft(preset);
      const intervalMiles = parseDraftValue(draft.miles);
      const intervalDays = parseDraftValue(draft.days);
      const intervalEngineHours = parseDraftValue(draft.engineHours);
      if ([intervalMiles, intervalDays, intervalEngineHours].some((value) => Number.isNaN(value))) {
        setError(`${preset.titleTr}: intervaller pozitif tam sayı olmalı.`);
        return;
      }
      if (intervalMiles == null && intervalDays == null && intervalEngineHours == null) {
        setError(`${preset.titleTr}: en az bir interval gerekli.`);
        return;
      }
      if (preset.engineRequirement && engineVehicleIds.size === 0) {
        setError(`${preset.titleTr}: en az bir unit seçin.`);
        return;
      }
      selections.push({
        presetId: preset.id,
        intervalMiles,
        intervalDays,
        intervalEngineHours,
        vehicleIds: preset.engineRequirement ? [...engineVehicleIds] : undefined,
      });
    }
    if (selections.length === 0) {
      setError("Oluşturulacak en az bir bakım seçin.");
      return;
    }

    startTransition(async () => {
      const response = await installMaintenanceProgram({ selectedVehicleType: vehicleType, selectedPackage: packageLevel, selections });
      setResult(response);
      if (response.error) setError(response.error);
    });
  }

  return (
    <>
      <button type="button" className="btn-primary" onClick={openInstaller}>Hazır Bakım Programı Kur</button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-5">
          <div className="my-3 w-full max-w-5xl rounded-lg bg-white p-4 shadow-xl sm:my-8 sm:p-6">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-lg font-bold">Hazır Bakım Programı Kur</h2>
                <p className="mt-1 text-sm text-slate-500">{step}. adım / 3</p>
              </div>
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Kapat</button>
            </div>

            {step === 1 && (
              <div className="py-5">
                <h3 className="font-semibold">1. Araç Türü</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {MAINTENANCE_PROGRAM_VEHICLE_OPTIONS.map((option) => {
                    const count = vehicles.filter((vehicle) => vehicle.vehicleType === option.value).length;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className="rounded-lg border border-slate-200 p-5 text-left hover:border-brand hover:bg-slate-50"
                        onClick={() => chooseVehicleType(option.value)}
                      >
                        <span className="block font-semibold">{option.label}</span>
                        <span className="mt-1 block text-sm text-slate-500">{count} aktif araç</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5 py-5">
                <div>
                  <h3 className="font-semibold">2. Bakım Paketi</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {([
                      { value: "basic" as const, title: "Temel Paket", description: "En önemli periyodik kontroller. Önerilen başlangıç." },
                      { value: "full" as const, title: "Tam Program", description: "Temel paket ile gelişmiş ve uzun dönem bakımlar." },
                    ]).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`rounded-lg border p-4 text-left ${packageLevel === option.value ? "border-brand bg-blue-50" : "border-slate-200"}`}
                        onClick={() => setPackageLevel(option.value)}
                      >
                        <span className="font-semibold">{option.title}</span>
                        <span className="mt-1 block text-sm text-slate-500">{option.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {vehicleType === "truck" && packageLevel === "full" && (
                  <details className="rounded-lg border border-slate-200 p-4">
                    <summary className="cursor-pointer font-medium">Motora Özel Bakımlar</summary>
                    <div className="mt-3 space-y-3 text-sm">
                      <label className="flex gap-2"><input type="radio" checked={engineChoice === "general"} onChange={() => setEngineChoice("general")} /> Genel / Motor bilinmiyor</label>
                      <label className="flex gap-2"><input type="radio" checked={engineChoice === "cummins_x15"} onChange={() => setEngineChoice("cummins_x15")} /> Cummins X15</label>
                      <label className="flex gap-2"><input type="radio" checked={engineChoice === "paccar_mx"} onChange={() => setEngineChoice("paccar_mx")} /> PACCAR MX</label>
                      {engineChoice === "cummins_x15" && <p className="rounded-md bg-slate-50 p-3 text-slate-600">Doğrulanmış ayrı bir Cummins-specific sabit reminder olmadığı için ek interval uydurulmaz.</p>}
                      {engineChoice === "paccar_mx" && (
                        <div className="rounded-md bg-amber-50 p-3">
                          <p className="font-medium text-amber-900">PACCAR ilk valve adjustment yalnızca seçilen unitlere kurulur.</p>
                          <p className="mt-1 text-amber-800">{hasEngineData ? "Engine modeline göre eşleşen aktif unitler gösteriliyor." : "Engine modeli kayıtlı değil; doğru unitleri elle seçin."}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {paccarVehicles.length === 0 ? <span className="text-amber-800">Eşleşen aktif unit yok.</span> : paccarVehicles.map((vehicle) => (
                              <label key={vehicle.id} className="flex items-center gap-2 rounded-md border border-amber-200 bg-white px-3 py-2">
                                <input type="checkbox" checked={engineVehicleIds.has(vehicle.id)} onChange={() => toggleEngineVehicle(vehicle.id)} />
                                Unit {vehicle.unitNumber}{vehicle.engineModel ? ` · ${vehicle.engineModel}` : ""}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </details>
                )}

                <div className="flex justify-between gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setStep(1)}>Geri</button>
                  <button type="button" className="btn-primary" onClick={prepareReview}>Kontrol Et</button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4 py-5">
                <div>
                  <h3 className="font-semibold">3. Kontrol Et ve Oluştur</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Hatırlatıcılar mevcut mileage ve bugünün tarihi başlangıç alınarak oluşturulacaktır. Her aracın takibi ayrı yapılır.
                  </p>
                </div>

                {(["frequent", "scheduled", "major"] as MaintenanceProgramSection[]).map((section) => {
                  const sectionPresets = presets.filter((preset) => preset.section === section);
                  if (sectionPresets.length === 0) return null;
                  return (
                    <details key={section} className="rounded-lg border border-slate-200" open={section === "frequent"}>
                      <summary className="cursor-pointer px-4 py-3 font-semibold">{SECTION_LABELS[section]} · {sectionPresets.length}</summary>
                      <div className="divide-y divide-slate-100 border-t border-slate-200">
                        {sectionPresets.map((preset) => {
                          const engineExistingRules = preset.engineRequirement
                            ? [...engineVehicleIds]
                                .map((vehicleId) => findExistingProgramReminder(preset, existingRules, vehicleType, vehicleId))
                                .filter((rule): rule is MaintenanceProgramExistingRule => rule != null)
                            : [];
                          const existing = preset.engineRequirement ? engineExistingRules[0] ?? null : findExistingProgramReminder(preset, existingRules, vehicleType);
                          const allSelectedEngineRulesExist = Boolean(preset.engineRequirement && engineVehicleIds.size > 0 && engineExistingRules.length === engineVehicleIds.size);
                          const draft = drafts[preset.id] ?? defaultDraft(preset);
                          const warning = presetWarning(preset, vehicleType);
                          const isEdited = !sameDraft(draft, defaultDraft(preset));
                          const affectedCount = preset.engineRequirement ? engineVehicleIds.size : activeVehicles.length;
                          return (
                            <div key={preset.id} className="p-4">
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  className="mt-1 h-4 w-4 accent-brand"
                                  checked={selectedIds.has(preset.id)}
                                  disabled={Boolean(!preset.engineRequirement && existing) || allSelectedEngineRulesExist}
                                  onChange={() => togglePreset(preset.id)}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="font-medium">{preset.titleTr}</h4>
                                    {existing && (
                                      <span className="badge bg-slate-100 text-slate-700">
                                        {preset.engineRequirement ? `${engineExistingRules.length} unitte mevcut` : "Zaten mevcut"}
                                      </span>
                                    )}
                                    {warning && <span className="badge bg-amber-100 text-amber-800">Doğrulama gerekli</span>}
                                  </div>
                                  <p className="mt-1 text-sm text-slate-500">{preset.descriptionTr}</p>
                                  <p className="mt-1 text-sm font-medium text-slate-700">
                                    {formatMaintenanceProgramInterval({
                                      intervalMiles: parseDraftValue(draft.miles),
                                      intervalDays: parseDraftValue(draft.days),
                                      intervalEngineHours: parseDraftValue(draft.engineHours),
                                    })}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">{affectedCount} {vehicleType === "truck" ? "Semi Truck" : "Box Truck"} için</p>
                                  {existing && <p className="mt-1 text-xs text-slate-500">Mevcut interval: {existingInterval(existing)}. Değişiklik normal Düzenle akışından yapılır.</p>}
                                  {warning && <p className="mt-1 text-xs text-amber-800">{warning}</p>}

                                  {(!existing || (preset.engineRequirement && !allSelectedEngineRulesExist)) && selectedIds.has(preset.id) && (
                                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                      <label className="text-xs text-slate-600">Mil
                                        <input className="input mt-1" type="number" min="1" step="1" value={draft.miles} onChange={(event) => patchDraft(preset.id, { miles: event.target.value })} />
                                      </label>
                                      <label className="text-xs text-slate-600">Gün
                                        <input className="input mt-1" type="number" min="1" step="1" value={draft.days} onChange={(event) => patchDraft(preset.id, { days: event.target.value })} />
                                      </label>
                                      <label className="text-xs text-slate-600">Engine saat
                                        <input className="input mt-1" type="number" min="1" step="1" value={draft.engineHours} onChange={(event) => patchDraft(preset.id, { engineHours: event.target.value })} />
                                      </label>
                                      {isEdited && <button type="button" className="text-left text-xs font-medium text-brand" onClick={() => setDrafts((current) => ({ ...current, [preset.id]: defaultDraft(preset) }))}>Varsayılana döndür</button>}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  );
                })}

                <details className="rounded-lg border border-slate-200 p-4">
                  <summary className="cursor-pointer font-medium">Operasyonel Kontroller ve Duruma Bağlı İşlemler</summary>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    {references.map((item) => <p key={item.id}><span className="font-medium text-slate-800">{item.titleTr}</span> · {item.descriptionTr}</p>)}
                    <Link href="/maintenance/inspections" className="inline-block font-medium text-brand hover:underline">Inspection bölümüne git</Link>
                  </div>
                </details>

                <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                  Seçilen hatırlatıcıların gösterilen intervallerle oluşturulmasını onaylıyorum.
                </label>

                {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                {result && (
                  <div className={`rounded-lg border p-4 ${result.failed > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                    <p className="font-medium">{result.created} hatırlatıcı oluşturuldu, {result.skipped} mevcut olduğu için atlandı, {result.failed} başarısız.</p>
                    <div className="mt-2 space-y-1 text-sm">
                      {result.results.filter((item) => item.status === "failed").map((item, index) => (
                        <p key={`${item.presetId}-${item.vehicleId ?? index}`} className="text-red-700">{item.title}{item.unitNumber ? ` · Unit ${item.unitNumber}` : ""}: {item.message}</p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap justify-between gap-2">
                  <button type="button" className="btn-ghost" disabled={isPending} onClick={() => setStep(2)}>Geri</button>
                  <button type="button" className="btn-primary" disabled={isPending || !confirmed} onClick={install}>{isPending ? "Oluşturuluyor..." : "Seçilenleri Oluştur"}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

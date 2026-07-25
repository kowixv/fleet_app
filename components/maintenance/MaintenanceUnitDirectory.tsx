"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import VehicleThumbnail from "@/components/VehicleThumbnail";
import { usd } from "@/lib/format";
import {
  filterMaintenanceUnits,
  maintenanceUnitHref,
  type MaintenanceUnitSummary,
  type UnitAttentionFilter,
  type UnitOperationalFilter,
} from "@/lib/maintenance-unit-summary";

const OPERATIONAL_FILTERS: Array<{
  value: UnitOperationalFilter;
  label: string;
}> = [
  { value: "all", label: "Tümü" },
  { value: "active", label: "Aktif" },
  { value: "in_repair", label: "Tamirde" },
  { value: "yard_hometime", label: "Yard / Hometime" },
  { value: "archived", label: "Arşiv" },
];

const ATTENTION_FILTERS: Array<{
  value: UnitAttentionFilter;
  label: string;
}> = [
  { value: "all", label: "Tümü" },
  { value: "overdue", label: "Gecikmiş" },
  { value: "due_now", label: "Bugün" },
  { value: "due_soon", label: "Yakında" },
  { value: "setup_required", label: "Kurulum Gerekli" },
  { value: "critical", label: "Kritik Bulgu" },
  { value: "ok", label: "Sorun Yok" },
];

interface Props {
  units: MaintenanceUnitSummary[];
  variant: "overview" | "full";
  includeArchived: boolean;
  initialQuery?: string;
  initialOperationalStatus?: UnitOperationalFilter;
  initialAttentionStatus?: UnitAttentionFilter;
  limit?: number;
  detailTab?: "inspections" | "mileage";
}

export default function MaintenanceUnitDirectory({
  units,
  variant,
  includeArchived,
  initialQuery = "",
  initialOperationalStatus = "all",
  initialAttentionStatus = "all",
  limit = 10,
  detailTab,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [operationalStatus, setOperationalStatus] =
    useState<UnitOperationalFilter>(initialOperationalStatus);
  const [attentionStatus, setAttentionStatus] =
    useState<UnitAttentionFilter>(initialAttentionStatus);

  const filtered = useMemo(
    () =>
      filterMaintenanceUnits(units, {
        query,
        operationalStatus,
        attentionStatus,
        includeArchived,
      }),
    [attentionStatus, includeArchived, operationalStatus, query, units],
  );
  const visible = variant === "overview" ? filtered.slice(0, limit) : filtered;

  const names =
    variant === "full"
      ? { query: "q", operational: "status", attention: "attention", archive: "archived" }
      : {
          query: "unitsQ",
          operational: "unitsStatus",
          attention: "unitsAttention",
          archive: "unitsArchive",
        };

  function replaceUrl(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [name, value] of Object.entries(patch)) {
      if (!value || value === "all") next.delete(name);
      else next.set(name, value);
    }
    const nextQuery = next.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (variant === "full") {
      replaceUrl({ [names.query]: query });
    }
  }

  function selectOperational(value: UnitOperationalFilter) {
    setOperationalStatus(value);
    const patch: Record<string, string | null> = {
      [names.operational]: value,
    };
    if (value === "archived" && !includeArchived) {
      patch[names.archive] = "1";
      patch[names.query] = query;
      patch[names.attention] = attentionStatus;
    }
    if (variant === "full" || value === "archived") replaceUrl(patch);
  }

  function selectAttention(value: UnitAttentionFilter) {
    setAttentionStatus(value);
    if (variant === "full") replaceUrl({ [names.attention]: value });
  }

  function toggleArchived(checked: boolean) {
    replaceUrl({
      [names.archive]: checked ? "1" : null,
      [names.query]: query,
      [names.operational]: operationalStatus,
      [names.attention]: attentionStatus,
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submitSearch} className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor={`${variant}-unit-search`}>
              Unit ara
            </label>
            <input
              id={`${variant}-unit-search`}
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Unit, VIN, marka veya model ara"
            />
          </div>
          {variant === "full" && (
            <div className="flex items-end">
              <button type="submit" className="btn-primary w-full sm:w-auto">
                Ara
              </button>
            </div>
          )}
        </div>

        <FilterRow label="Status">
          {OPERATIONAL_FILTERS.map((filter) => (
            <FilterButton
              key={filter.value}
              active={operationalStatus === filter.value}
              label={filter.label}
              onClick={() => selectOperational(filter.value)}
            />
          ))}
        </FilterRow>

        <FilterRow label="Bakım durumu">
          {ATTENTION_FILTERS.map((filter) => (
            <FilterButton
              key={filter.value}
              active={attentionStatus === filter.value}
              label={filter.label}
              onClick={() => selectAttention(filter.value)}
            />
          ))}
        </FilterRow>

        <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => toggleArchived(event.target.checked)}
            className="h-4 w-4 accent-brand"
          />
          Arşivdekileri Göster
        </label>
      </form>

      {units.length === 0 ? (
        <EmptyState>Henüz bakım için kayıtlı unit bulunmuyor.</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>Arama ve filtrelerle eşleşen unit bulunamadı.</EmptyState>
      ) : (
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          {visible.map((unit) => (
            <MaintenanceUnitCard key={unit.id} unit={unit} detailTab={detailTab} />
          ))}
        </div>
      )}

      {variant === "overview" && filtered.length > visible.length && (
        <p className="text-sm text-slate-500">
          En yüksek öncelikli {visible.length} unit gösteriliyor.
        </p>
      )}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="flex gap-2 overflow-x-auto pb-1">{children}</div>
    </div>
  );
}

function FilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-10 shrink-0 rounded-full border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
        active
          ? "border-brand bg-brand text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
}

function MaintenanceUnitCard({
  unit,
  detailTab,
}: {
  unit: MaintenanceUnitSummary;
  detailTab?: "inspections" | "mileage";
}) {
  const severe = unit.dispatchHoldCount > 0 || unit.doNotDispatchCount > 0;
  const critical = unit.criticalFindingCount > 0;
  const border = severe
    ? "border-red-500 ring-1 ring-red-200"
    : critical || unit.maintenanceStatus === "overdue"
      ? "border-red-200"
      : unit.maintenanceStatus === "due_now"
        ? "border-orange-200"
        : unit.maintenanceStatus === "due_soon"
          ? "border-amber-200"
          : "border-slate-200";
  const vehicleDescription =
    [unit.year, unit.make, unit.model].filter(Boolean).join(" ") || unit.vehicleType;
  const vinSuffix = unit.vin?.trim() ? unit.vin.trim().slice(-6).toUpperCase() : null;

  return (
    <Link
      href={maintenanceUnitHref(unit.id, detailTab)}
      className={`group block min-w-0 rounded-xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${border}`}
      aria-label={`Unit ${unit.unitNumber} bakım detayını aç`}
      data-testid={`maintenance-unit-${unit.id}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <VehicleThumbnail
          make={unit.make}
          model={unit.model}
          color={unit.truckColor}
          vehicleType={unit.vehicleType}
          width={88}
          height={58}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Unit</p>
              <h3 className="text-xl font-bold text-slate-950">{unit.unitNumber}</h3>
            </div>
            <MaintenanceBadge status={unit.maintenanceStatus} />
          </div>
          <p className="mt-1 truncate text-sm text-slate-600">{vehicleDescription}</p>
          {vinSuffix && <p className="mt-0.5 text-xs text-slate-400">VIN •••{vinSuffix}</p>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <OperationalBadge status={unit.operationalStatus} />
        {severe && <span className="badge bg-red-700 font-bold text-white">SEVKE ÇIKMASIN</span>}
        {critical && <span className="badge bg-red-100 text-red-700">Kritik bulgu</span>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Metric
          label="Mileage"
          value={
            unit.currentMileage == null
              ? "Mileage bilgisi gerekli."
              : `${unit.currentMileage.toLocaleString("en-US")} mi`
          }
          missing={unit.currentMileage == null}
        />
        <Metric
          label="Engine hours"
          value={
            unit.engineHours == null
              ? "Engine hours girilmemiş."
              : unit.engineHours.toLocaleString("en-US")
          }
          missing={unit.engineHours == null}
        />
      </div>

      {!unit.hasActivePlan && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Bu unit için aktif bakım hatırlatıcısı bulunmuyor.
        </p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Count label="Gecikmiş" value={unit.overdueCount} tone="red" />
        <Count label="Bugün / Yakında" value={unit.dueNowCount + unit.dueSoonCount} tone="amber" />
        <Count
          label="Kritik"
          value={
            unit.criticalFindingCount +
            unit.doNotDispatchCount +
            unit.dispatchHoldCount
          }
          tone="red"
        />
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3 text-sm">
        <p className="text-xs text-slate-500">Son tamamlanan servis</p>
        {unit.lastServiceDate ? (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-slate-700">
            <span>
              {unit.lastServiceDate} · {unit.lastServiceType ?? "Bakım"}
            </span>
            <span className="font-semibold">
              {unit.lastServiceCost == null ? "Maliyet yok" : usd(unit.lastServiceCost)}
            </span>
          </div>
        ) : (
          <p className="mt-1 text-slate-400">Tamamlanan servis kaydı yok.</p>
        )}
      </div>

      <span className="mt-4 flex min-h-11 w-full items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition group-hover:bg-brand-dark">
        Bakım Detayını Aç
      </span>
    </Link>
  );
}

function MaintenanceBadge({ status }: { status: MaintenanceUnitSummary["maintenanceStatus"] }) {
  const config = {
    overdue: { label: "Gecikmiş", className: "bg-red-100 text-red-700" },
    due_now: { label: "Bugün", className: "bg-orange-100 text-orange-700" },
    setup_required: { label: "Kurulum Gerekli", className: "bg-slate-100 text-slate-700" },
    due_soon: { label: "Yakında", className: "bg-amber-100 text-amber-700" },
    ok: { label: "Sorun Yok", className: "bg-green-100 text-green-700" },
    no_plan: { label: "Hatırlatıcı Yok", className: "bg-slate-100 text-slate-600" },
  }[status];
  return <span className={`badge ${config.className}`}>{config.label}</span>;
}

function OperationalBadge({ status }: { status: string }) {
  const config =
    status === "active"
      ? { label: "Aktif", className: "bg-emerald-50 text-emerald-700" }
      : status === "in_repair"
        ? { label: "Tamirde", className: "bg-indigo-100 text-indigo-700" }
        : status === "yard_hometime"
          ? { label: "Yard / Hometime", className: "bg-slate-100 text-slate-700" }
          : { label: "Arşiv", className: "bg-slate-200 text-slate-600" };
  return <span className={`badge ${config.className}`}>{config.label}</span>;
}

function Metric({
  label,
  value,
  missing = false,
}: {
  label: string;
  value: string;
  missing?: boolean;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${missing ? "text-amber-700" : "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "red" | "amber";
}) {
  const active = value > 0;
  return (
    <div
      className={`rounded-lg px-2 py-2 ${
        active
          ? tone === "red"
            ? "bg-red-50 text-red-700"
            : "bg-amber-50 text-amber-700"
          : "bg-slate-50 text-slate-500"
      }`}
    >
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[11px]">{label}</p>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

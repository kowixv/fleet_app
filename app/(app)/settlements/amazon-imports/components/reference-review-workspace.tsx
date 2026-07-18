"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveAmazonReferenceTaskAction } from "../actions";
import {
  validateEffectiveDates,
  validateFacilityFields,
  validateReferenceReason,
  validateTeamSplitBasisPoints,
  validateUniqueSelections,
  type ReferenceReviewCategory,
} from "@/lib/amazon-statements/reference-review-validation";

type PersonOption = { id: string; label: string; type: string; status: string };
type VehicleOption = { id: string; unitNumber: string; description: string; status: string };
type ReviewTask = {
  id: string;
  category: ReferenceReviewCategory;
  issueCode: string;
  severity: "warning" | "blocking" | "info";
  provider: string;
  identifierType: string;
  safeExternalDisplay: string;
  affectedRevenueItems: number;
  affectedFuelGroups: number;
  effectiveDateRange: string;
  status: string;
  availableActions: string[];
  dependencySummaries: Array<{ kind: string; count: number; label: string }>;
  impactPreview: {
    revenueItemsAffected: number;
    fuelGroupsAffected: number;
    readinessChanges: string[];
    statementDisplayDependencies: number;
    settlementDependencies: number;
  };
  placeholder: boolean;
  financialBlocked: boolean;
  sourceRevision: string | null;
  teamMemberCount: number;
};
type ReviewHistoryItem = {
  id: string;
  category: ReferenceReviewCategory | "unknown";
  decisionType: string;
  status: string;
  reviewer: string;
  decidedAt: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  reason: string;
  safeSummary: string;
  supersededOrArchived: boolean;
};
type ReviewView = {
  batchId: string;
  role: "viewer" | "writer";
  archived: boolean;
  canMutate: boolean;
  tasks: ReviewTask[];
  options: { people: PersonOption[]; vehicles: VehicleOption[] };
  counts: { byCategory: Record<ReferenceReviewCategory, number> };
  history: ReviewHistoryItem[];
};

const CATEGORY_LABELS: Record<ReferenceReviewCategory, string> = {
  driver: "Driver identifiers",
  vehicle: "Vehicle identifiers",
  facility: "Facility mappings",
  fuel_assignment: "Fuel assignments",
  team_split: "Team split rules",
};

export default function ReferenceReviewWorkspace({ review }: { review: ReviewView }) {
  const [active, setActive] = useState<ReferenceReviewCategory>("driver");
  const tasks = useMemo(() => review.tasks.filter((task) => task.category === active), [active, review.tasks]);

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded border border-slate-200 bg-white p-1" role="tablist" aria-label="Reference categories">
        <div className="flex min-w-max gap-1">
          {(Object.keys(CATEGORY_LABELS) as ReferenceReviewCategory[]).map((category) => (
            <button
              key={category}
              type="button"
              role="tab"
              aria-selected={active === category}
              className={`rounded px-3 py-2 text-sm ${active === category ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              onClick={() => setActive(category)}
            >
              {CATEGORY_LABELS[category]} ({review.counts.byCategory[category] ?? 0})
            </button>
          ))}
        </div>
      </div>

      <section className="space-y-3">
        {tasks.length === 0 ? (
          <div className="card text-sm text-slate-500">No unresolved root issues in this category.</div>
        ) : (
          tasks.map((task) => (
            <ReferenceTaskCard key={task.id} review={review} task={task} />
          ))
        )}
      </section>

      <ReviewHistory history={review.history} />
    </div>
  );
}

function ReferenceTaskCard({ review, task }: { review: ReviewView; task: ReviewTask }) {
  const router = useRouter();
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [remaining, setRemaining] = useState(10000);
  const [isPending, startTransition] = useTransition();
  const disabled = !review.canMutate || isPending || task.placeholder || task.financialBlocked;

  function submit(formData: FormData, operation: "approve" | "reject" | "archive") {
    setMessage(null);
    const reason = stringValue(formData.get("reason"));
    const reasonError = validateReferenceReason(reason);
    if (reasonError) return showError(reasonError);
    const effectiveFrom = stringValue(formData.get("effective_from"));
    const effectiveTo = stringValue(formData.get("effective_to"));
    if (operation === "approve") {
      const dateError = validateEffectiveDates(effectiveFrom, effectiveTo || null);
      if (dateError) return showError(dateError);
    }
    const payload = payloadForTask(review.batchId, task, formData, operation, reason, effectiveFrom, effectiveTo || null);
    const clientError = validatePayload(task, payload);
    if (clientError) return showError(clientError);
    startTransition(async () => {
      const result = await resolveAmazonReferenceTaskAction(payload);
      if (!result.ok) {
        showError(result.error.message);
        return;
      }
      setMessage({ type: "success", text: `Saved. ${result.data.resolvedCount ?? 0} dependent issue rows were marked resolved.` });
      router.refresh();
    });
  }

  function showError(text: string) {
    setMessage({ type: "error", text });
    window.setTimeout(() => errorRef.current?.focus(), 0);
  }

  return (
    <article className="card space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-1 text-xs font-medium ${task.severity === "blocking" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
              {task.severity}
            </span>
            <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{task.provider}</span>
            <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{task.identifierType}</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">{CATEGORY_LABELS[task.category]}</h2>
          <p className="text-sm text-slate-600">{task.safeExternalDisplay}</p>
          <p className="mt-1 text-xs text-slate-500">{task.effectiveDateRange}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm md:min-w-64">
          <Metric label="Revenue" value={task.affectedRevenueItems} />
          <Metric label="Fuel groups" value={task.affectedFuelGroups} />
        </div>
      </div>

      <details className="rounded border border-slate-200 bg-slate-50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">Safe dependency impact preview</summary>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          {task.dependencySummaries.map((item) => (
            <Metric key={`${item.kind}-${item.label}`} label={item.label} value={item.count} />
          ))}
          <div className="rounded border border-slate-200 bg-white p-3">
            <p className="text-xs uppercase text-slate-400">Readiness expected to change</p>
            <p className="font-medium text-slate-900">{task.impactPreview.readinessChanges.join(", ")}</p>
          </div>
          <div className="rounded border border-slate-200 bg-white p-3">
            <p className="text-xs uppercase text-slate-400">Financial amount changes</p>
            <p className="font-medium text-slate-900">None claimed</p>
          </div>
        </div>
      </details>

      {task.placeholder ? (
        <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          Placeholder fuel group. This is informational and requires no assignment.
        </p>
      ) : null}
      {task.financialBlocked ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Fuel financial reconciliation failure blocks approval. Rejection remains available.
        </p>
      ) : null}

      <form id={`reference-form-${task.id}`} action={(formData) => submit(formData, "approve")} className="space-y-4">
        <input type="hidden" name="expected_source_revision" value={task.sourceRevision ?? ""} />
        {task.category === "driver" ? <PersonSelect people={review.options.people} name="person_id" label="Internal person" /> : null}
        {task.category === "vehicle" ? <VehicleSelect vehicles={review.options.vehicles} name="vehicle_id" label="Internal vehicle" /> : null}
        {task.category === "facility" ? <FacilityFields /> : null}
        {task.category === "fuel_assignment" ? <FuelAssignmentFields people={review.options.people} vehicles={review.options.vehicles} /> : null}
        {task.category === "team_split" ? <TeamSplitFields people={review.options.people} memberCount={task.teamMemberCount} onRemainingChange={setRemaining} remaining={remaining} /> : null}
        <DateReasonFields />
        {message ? (
          <p
            ref={message.type === "error" ? errorRef : undefined}
            tabIndex={message.type === "error" ? -1 : undefined}
            aria-live="polite"
            className={`text-sm ${message.type === "error" ? "text-red-600" : "text-green-700"}`}
          >
            {message.text}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {task.availableActions.includes("reject") || task.availableActions.includes("archive") ? (
            <button
              type="button"
              className="btn-ghost"
              disabled={!review.canMutate || isPending}
              onClick={() => {
                const form = document.getElementById(`reference-form-${task.id}`) as HTMLFormElement | null;
                if (form) submit(new FormData(form), task.availableActions.includes("archive") ? "archive" : "reject");
              }}
            >
              {task.availableActions.includes("archive") ? "Archive Rule" : "Reject Mapping"}
            </button>
          ) : null}
          <button type="submit" disabled={disabled || (task.category === "team_split" && remaining !== 0)} className="btn-primary">
            {isPending ? "Saving..." : approveLabel(task.category)}
          </button>
        </div>
      </form>
    </article>
  );
}

function payloadForTask(batchId: string, task: ReviewTask, formData: FormData, operation: "approve" | "reject" | "archive", reason: string, effectiveFrom: string, effectiveTo: string | null) {
  const members = task.category === "team_split"
    ? Array.from({ length: Math.max(2, task.teamMemberCount) }, (_, index) => ({
      personId: stringValue(formData.get(`member_${index + 1}_person_id`)),
      splitBasisPoints: Number(stringValue(formData.get(`member_${index + 1}_basis_points`))),
    })).filter((member) => member.personId || Number.isFinite(member.splitBasisPoints))
    : undefined;
  return {
    batchId,
    taskId: task.id,
    operation,
    reason,
    expectedSourceRevision: stringValue(formData.get("expected_source_revision")) || null,
    personId: stringValue(formData.get("person_id")) || null,
    vehicleId: stringValue(formData.get("vehicle_id")) || null,
    driverId: stringValue(formData.get("driver_id")) || null,
    effectiveFrom,
    effectiveTo,
    city: stringValue(formData.get("city")) || null,
    state: stringValue(formData.get("state")) || null,
    postalCode: stringValue(formData.get("postal_code")) || null,
    countryCode: stringValue(formData.get("country_code")) || "US",
    timezone: stringValue(formData.get("timezone")) || null,
    verificationSource: stringValue(formData.get("verification_source")) || null,
    members,
  };
}

function validatePayload(task: ReviewTask, payload: ReturnType<typeof payloadForTask>) {
  if (payload.operation !== "approve") return null;
  if (task.category === "driver" && !payload.personId) return "Select exactly one internal person.";
  if (task.category === "vehicle" && !payload.vehicleId) return "Select exactly one internal vehicle.";
  if (task.category === "facility") {
    const result = validateFacilityFields({
      city: payload.city ?? "",
      state: payload.state ?? "",
      countryCode: payload.countryCode ?? "US",
      postalCode: payload.postalCode,
      timezone: payload.timezone,
    });
    if (!result.ok) return Object.values(result.errors)[0] ?? "Facility fields are invalid.";
    if (!payload.verificationSource) return "Verification source is required.";
  }
  if (task.category === "fuel_assignment" && !payload.vehicleId && !payload.driverId) return "Select a vehicle, driver, or both.";
  if (task.category === "team_split") {
    const members = payload.members ?? [];
    return validateTeamSplitBasisPoints(members.map((member) => member.splitBasisPoints))
      ?? validateUniqueSelections(members.map((member) => member.personId));
  }
  return null;
}

function PersonSelect({ people, name, label }: { people: PersonOption[]; name: string; label: string }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} className="input" defaultValue="">
        <option value="">Select existing person</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>{person.label} · {person.type}</option>
        ))}
      </select>
    </div>
  );
}

function VehicleSelect({ vehicles, name, label }: { vehicles: VehicleOption[]; name: string; label: string }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} className="input" defaultValue="">
        <option value="">Select existing vehicle</option>
        {vehicles.map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>Unit {vehicle.unitNumber} · {vehicle.description}</option>
        ))}
      </select>
    </div>
  );
}

function FacilityFields() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <TextField name="city" label="City" required />
      <TextField name="state" label="State" required maxLength={2} />
      <TextField name="postal_code" label="Postal code" maxLength={20} />
      <TextField name="country_code" label="Country" required defaultValue="US" maxLength={2} />
      <TextField name="timezone" label="Timezone" maxLength={64} />
      <TextField name="verification_source" label="Verification source" required maxLength={120} />
    </div>
  );
}

function FuelAssignmentFields({ people, vehicles }: { people: PersonOption[]; vehicles: VehicleOption[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <VehicleSelect vehicles={vehicles} name="vehicle_id" label="Internal vehicle" />
      <PersonSelect people={people} name="driver_id" label="Internal driver" />
      <p className="text-xs text-slate-500 md:col-span-2">
        Driver label alone never approves a financial assignment automatically. Approving here does not create public expenses or choose a deduction lane.
      </p>
    </div>
  );
}

function TeamSplitFields({
  people,
  memberCount,
  onRemainingChange,
  remaining,
}: {
  people: PersonOption[];
  memberCount: number;
  onRemainingChange: (value: number) => void;
  remaining: number;
}) {
  function updateRemaining(form: HTMLDivElement | null) {
    if (!form) return;
    const values = Array.from(form.querySelectorAll<HTMLInputElement>("input[data-basis-points]"))
      .map((input) => Number(input.value || 0))
      .filter((value) => Number.isFinite(value));
    onRemainingChange(10000 - values.reduce((sum, value) => sum + value, 0));
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Enter integer basis points. 10000 basis points equals 100%.</p>
      {Array.from({ length: Math.max(2, memberCount) }, (_, index) => (
        <div key={index} className="grid gap-3 md:grid-cols-[1fr_12rem]">
          <PersonSelect people={people} name={`member_${index + 1}_person_id`} label={`Ordered member ${index + 1}`} />
          <div>
            <label className="label" htmlFor={`member_${index + 1}_basis_points`}>Basis points</label>
            <input
              id={`member_${index + 1}_basis_points`}
              name={`member_${index + 1}_basis_points`}
              type="number"
              min="1"
              max="10000"
              step="1"
              className="input"
              data-basis-points
              onInput={(event) => updateRemaining(event.currentTarget.closest(".space-y-3"))}
            />
          </div>
        </div>
      ))}
      <p aria-live="polite" className={`text-sm ${remaining === 0 ? "text-green-700" : "text-slate-600"}`}>
        Remaining basis points: {remaining}
      </p>
    </div>
  );
}

function DateReasonFields() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <TextField name="effective_from" label="Effective from" type="date" required />
      <TextField name="effective_to" label="Effective to" type="date" />
      <div className="md:col-span-3">
        <label className="label" htmlFor="reason">Review reason</label>
        <textarea id="reason" name="reason" className="input" rows={3} maxLength={500} required />
      </div>
    </div>
  );
}

function TextField({
  name,
  label,
  type = "text",
  required,
  maxLength,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
  defaultValue?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} className="input" required={required} maxLength={maxLength} defaultValue={defaultValue} />
    </div>
  );
}

function ReviewHistory({ history }: { history: ReviewHistoryItem[] }) {
  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">Review decision history</h2>
      <p className="text-sm text-slate-500">Raw previous and selected JSON values are reduced into safe summaries.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Category</th>
              <th className="th">Decision</th>
              <th className="th">Status</th>
              <th className="th">Reviewer</th>
              <th className="th">Time</th>
              <th className="th">Effective dates</th>
              <th className="th">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {history.length === 0 ? (
              <tr><td className="td text-slate-400" colSpan={7}>No review decisions yet.</td></tr>
            ) : history.map((item) => (
              <tr key={item.id}>
                <td className="td">{item.category}</td>
                <td className="td">{item.safeSummary}</td>
                <td className="td">{item.status}{item.supersededOrArchived ? " · archived" : ""}</td>
                <td className="td">{item.reviewer}</td>
                <td className="td">{item.decidedAt ? new Date(item.decidedAt).toLocaleString() : "-"}</td>
                <td className="td">{item.effectiveFrom ?? "-"} - {item.effectiveTo ?? "open"}</td>
                <td className="td">{item.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase text-slate-400">{label}</p>
      <p className="text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function approveLabel(category: ReferenceReviewCategory) {
  if (category === "facility") return "Verify Mapping";
  if (category === "fuel_assignment") return "Approve Assignment";
  if (category === "team_split") return "Approve Rule";
  return "Approve Mapping";
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

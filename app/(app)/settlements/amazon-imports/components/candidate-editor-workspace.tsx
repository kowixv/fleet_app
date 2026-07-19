"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usd } from "@/lib/format";
import {
  approveAmazonCandidateAction,
  archiveAmazonCandidateAction,
  convertAmazonCandidateAction,
  createAmazonCandidateAction,
  previewAmazonCandidateAction,
} from "../actions";
import WorkflowActionResult from "./workflow-action-result";

type StatementType = "company_driver" | "box_truck_driver" | "owner_operator" | "managed_investor";
type FuelPolicy = "transaction_date_in_period" | "fuel_report_period" | "manual_reviewed_selection" | "no_fuel";
type LanguageMode = "en" | "tr" | "en_tr";

type EditorView = {
  batchId: string;
  candidateId: string | null;
  mode: "create" | "edit" | "readonly";
  status: string;
  canEdit: boolean;
  statementType: StatementType | null;
  payeeType: "driver" | "owner" | "investor" | null;
  payeeId: string | null;
  vehicleId: string | null;
  fuelInclusionPolicy: FuelPolicy;
  templateVersion: string;
  languageMode: LanguageMode;
  periodStart: string | null;
  periodEnd: string | null;
  previewRevision: string | null;
  selectedRevenueItemIds: string[];
  selectedFuelLineIds: string[];
  options: {
    people: Array<{ id: string; label: string; type: string }>;
    vehicles: Array<{ id: string; label: string; vehicleType: string; ownershipType: string; ownerId: string | null }>;
    templates: Array<{ version: string; label: string }>;
    languages: Array<{ value: LanguageMode; label: string }>;
  };
  revenueSources: Array<{
    revenueItemId: string;
    loadId: string;
    serviceDateRange: string;
    routeDisplay: string;
    unitDisplay: string;
    miles: number | null;
    baseAmount: number;
    fuelSurchargeAmount: number;
    tollAmount: number;
    detentionAmount: number;
    tonuAmount: number;
    otherAmount: number;
    grossAmount: number;
    projectionStatus: string;
    settlementEligible: boolean;
    sourceRevisionStatus: "current";
  }>;
  fuelSources: Array<{
    transactionLineId: string;
    expenseId: string;
    transactionDate: string | null;
    maskedTransactionReference: string;
    product: string;
    quantity: number | null;
    chargedAmount: number;
    discountAmount: number | null;
    assignmentStatus: string;
    deductionReady: boolean;
    placeholder: boolean;
    sourceRevisionStatus: "current";
  }>;
  calculation: null | {
    status: string;
    gross: number;
    percentageDeductions: number;
    fixedDeductions: number;
    fuelDeductions: number;
    otherDeductions: number;
    totalDeductions: number;
    net: number;
    previewRevision: string;
    lineItems: Array<{ key: string; label: string; amount: number; isOurRevenue: boolean }>;
    blockers: string[];
    warnings: string[];
  };
};

type AdjustmentState = {
  type: "company_percentage" | "driver_percentage" | "insurance" | "eld_safety" | "toll" | "parking" | "load_save" | "maintenance" | "miscellaneous" | "carryover";
  enabled: boolean;
  basis: "gross_percentage" | "fixed_amount";
  label: string;
  rate: string;
  amount: string;
};

type AutoSelectionResponse = {
  vehicleId: string | null;
  selectedRevenueItemIds: string[];
  selectedFuelLineIds: string[];
  exactRevenueCount: number;
  exactFuelCount: number;
  revenueReviewRequiredCount: number;
  fuelReviewRequiredCount: number;
  error?: string;
};

const STATEMENT_TYPES: Array<{ value: StatementType; label: string }> = [
  { value: "company_driver", label: "Company Driver" },
  { value: "box_truck_driver", label: "Box Truck Driver" },
  { value: "owner_operator", label: "Owner Operator" },
  { value: "managed_investor", label: "Managed Investor" },
];

const DEFAULT_ADJUSTMENTS: AdjustmentState[] = [
  { type: "company_percentage", enabled: false, basis: "gross_percentage", label: "Company fee", rate: "12", amount: "" },
  { type: "driver_percentage", enabled: false, basis: "gross_percentage", label: "Driver pay", rate: "30", amount: "" },
  { type: "insurance", enabled: false, basis: "fixed_amount", label: "Insurance", rate: "", amount: "0" },
  { type: "eld_safety", enabled: false, basis: "fixed_amount", label: "ELD/Safety", rate: "", amount: "0" },
  { type: "parking", enabled: false, basis: "fixed_amount", label: "Parking", rate: "", amount: "0" },
  { type: "load_save", enabled: false, basis: "fixed_amount", label: "Load save", rate: "", amount: "0" },
  { type: "maintenance", enabled: false, basis: "fixed_amount", label: "Maintenance", rate: "", amount: "0" },
  { type: "carryover", enabled: false, basis: "fixed_amount", label: "Carryover", rate: "", amount: "0" },
];

export default function CandidateEditorWorkspace({ view }: { view: EditorView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [autoSelecting, setAutoSelecting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error" | "info"; text: string } | null>(null);
  const [preview, setPreview] = useState(view.calculation);
  const [statementType, setStatementType] = useState<StatementType | "">(view.statementType ?? "");
  const [periodStart, setPeriodStart] = useState(view.periodStart ?? new Date().toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(view.periodEnd ?? new Date().toISOString().slice(0, 10));
  const [payeeId, setPayeeId] = useState(view.payeeId ?? "");
  const [vehicleId, setVehicleId] = useState(view.vehicleId ?? "");
  const [fuelPolicy, setFuelPolicy] = useState<FuelPolicy>(view.fuelInclusionPolicy ?? "transaction_date_in_period");
  const [languageMode, setLanguageMode] = useState<LanguageMode>(view.languageMode ?? "en_tr");
  const [templateVersion, setTemplateVersion] = useState(view.templateVersion ?? "amazon-statement-v1");
  const [selectedRevenue, setSelectedRevenue] = useState<string[]>(view.selectedRevenueItemIds);
  const [selectedFuel, setSelectedFuel] = useState<string[]>(view.selectedFuelLineIds);
  const [adjustments, setAdjustments] = useState<AdjustmentState[]>(DEFAULT_ADJUSTMENTS);
  const readOnly = !view.canEdit || view.mode === "readonly";
  const compatiblePeople = useMemo(() => view.options.people.filter((person) => statementType !== "" && personMatchesStatement(person.type, statementType)), [statementType, view.options.people]);
  const compatibleRevenue = view.revenueSources.filter((source) => source.projectionStatus === "projected");
  const compatibleFuel = view.fuelSources.filter((source) => !source.placeholder && source.sourceRevisionStatus === "current");

  function payload() {
    if (statementType === "") throw new Error("Select a statement type before recalculating or saving.");
    const payeeType: "driver" | "owner" | "investor" = statementType === "managed_investor" ? "investor" : statementType === "owner_operator" ? "owner" : "driver";
    const fixedAdjustments = adjustments
      .filter((adjustment) => adjustment.enabled)
      .map((adjustment, index) => ({
        adjustmentType: adjustment.type,
        label: adjustment.label,
        calculationBasis: adjustment.basis,
        rateBasisPoints: adjustment.basis === "gross_percentage" ? Math.round(Number(adjustment.rate || 0) * 100) : null,
        fixedAmount: adjustment.basis === "fixed_amount" ? Number(adjustment.amount || 0) : null,
        deductionLane: payeeType,
        displayOrder: 10 + index,
        configurationSource: "candidate_editor",
      }));
    return {
      batchId: view.batchId,
      candidateId: view.candidateId,
      expectedPreviewRevision: view.previewRevision,
      statementType,
      periodStart,
      periodEnd,
      payeeType,
      payeeId,
      vehicleId: vehicleId || null,
      companyFeeBasisPoints: adjustmentRate("company_percentage"),
      driverPayBasisPoints: adjustmentRate("driver_percentage"),
      externalCarrierFeeBasisPoints: 0,
      fuelInclusionPolicy: fuelPolicy,
      templateVersion,
      languageMode,
      selectedRevenueItemIds: selectedRevenue,
      selectedFuelLineIds: fuelPolicy === "no_fuel" ? [] : selectedFuel,
      fixedAdjustments: fixedAdjustments.filter((adjustment) => adjustment.adjustmentType !== "company_percentage" && adjustment.adjustmentType !== "driver_percentage"),
    };
  }

  async function applyAutomaticSelection(nextStatementType: StatementType | "", nextPayeeId: string, nextVehicleId: string) {
    if (!nextStatementType || !nextPayeeId) {
      setSelectedRevenue([]);
      setSelectedFuel([]);
      setPreview(null);
      return;
    }

    setAutoSelecting(true);
    setMessage({ type: "info", text: "Finding exact Trips and fuel assignments for the selected payee..." });
    try {
      const response = await fetch(`/api/settlements/amazon-imports/${view.batchId}/candidate-auto-selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          statementType: nextStatementType,
          payeeId: nextPayeeId,
          vehicleId: nextVehicleId || null,
        }),
      });
      const data = await response.json() as AutoSelectionResponse;
      if (!response.ok) throw new Error(data.error ?? "Automatic source selection failed.");

      if (data.vehicleId) setVehicleId(data.vehicleId);
      setSelectedRevenue(data.selectedRevenueItemIds);
      setSelectedFuel(data.selectedFuelLineIds);
      setPreview(null);
      const reviewCount = data.revenueReviewRequiredCount + data.fuelReviewRequiredCount;
      setMessage({
        type: reviewCount > 0 ? "info" : "ok",
        text: `Exact matches selected automatically: ${data.exactRevenueCount} load(s), ${data.exactFuelCount} fuel line(s).${reviewCount > 0 ? ` ${reviewCount} unmatched or ambiguous row(s) remain unselected for review.` : ""}`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Automatic source selection failed." });
    } finally {
      setAutoSelecting(false);
    }
  }

  function handleStatementTypeChange(next: StatementType | "") {
    setStatementType(next);
    setPayeeId("");
    setVehicleId("");
    setSelectedRevenue([]);
    setSelectedFuel([]);
    setPreview(null);
    setMessage(null);
  }

  function handlePayeeChange(nextPayeeId: string) {
    setPayeeId(nextPayeeId);
    void applyAutomaticSelection(statementType, nextPayeeId, vehicleId);
  }

  function handleVehicleChange(nextVehicleId: string) {
    setVehicleId(nextVehicleId);
    void applyAutomaticSelection(statementType, payeeId, nextVehicleId);
  }

  function recalculate() {
    setMessage(null);
    let candidateInput: ReturnType<typeof payload>;
    try {
      candidateInput = payload();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Candidate input is incomplete." });
      return;
    }
    startTransition(async () => {
      const result = await previewAmazonCandidateAction(candidateInput);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error.message });
        return;
      }
      setPreview(result.data);
      setMessage({ type: "ok", text: `Preview recalculated: ${result.data.previewRevision.slice(0, 8)}.` });
    });
  }

  function save() {
    setMessage(null);
    let candidateInput: ReturnType<typeof payload>;
    try {
      candidateInput = payload();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Candidate input is incomplete." });
      return;
    }
    startTransition(async () => {
      const result = await createAmazonCandidateAction(candidateInput);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error.message });
        return;
      }
      setMessage({ type: "ok", text: `Candidate saved: ${result.data.previewRevision.slice(0, 8)}.` });
      router.push(`/settlements/amazon-imports/${view.batchId}/candidates/${result.data.candidateId}`);
      router.refresh();
    });
  }

  function approve() {
    if (!view.candidateId || !view.previewRevision) return;
    runAction(() => approveAmazonCandidateAction({ candidateId: view.candidateId ?? "", expectedPreviewRevision: view.previewRevision ?? "" }), "Candidate approved Ready.");
  }

  function convert() {
    if (!view.candidateId || !view.previewRevision) return;
    runAction(() => convertAmazonCandidateAction({ candidateId: view.candidateId ?? "", expectedPreviewRevision: view.previewRevision ?? "" }), "Candidate converted.");
  }

  function archive() {
    if (!view.candidateId) return;
    runAction(() => archiveAmazonCandidateAction({ candidateId: view.candidateId ?? "", expectedPreviewRevision: view.previewRevision }), "Candidate archived.");
  }

  function runAction(action: () => Promise<{ ok: true; data: unknown } | { ok: false; error: { message: string } }>, okText: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setMessage({ type: "error", text: result.error.message });
        return;
      }
      setMessage({ type: "ok", text: okText });
      router.refresh();
    });
  }

  function adjustmentRate(type: AdjustmentState["type"]) {
    const adjustment = adjustments.find((item) => item.type === type && item.enabled);
    return adjustment ? Math.round(Number(adjustment.rate || 0) * 100) : null;
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold">Candidate editor</h2>
            <p className="text-sm text-slate-500">Status: {view.status}. Exact approved source mappings are selected automatically; manual edits remain available.</p>
          </div>
          <Link className="btn-ghost" href={`/settlements/amazon-imports/${view.batchId}?tab=candidates`}>Back to candidates</Link>
        </div>
      </div>
      {message ? <WorkflowActionResult type={message.type} message={message.text} /> : null}
      <section className="card grid gap-3 md:grid-cols-3">
        <label className="text-sm">Statement type
          <select className="input mt-1" value={statementType} disabled={readOnly || autoSelecting} onChange={(event) => handleStatementTypeChange(event.target.value as StatementType | "")}>
            <option value="">Select statement type</option>
            {STATEMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </label>
        <label className="text-sm">Payee
          <select className="input mt-1" value={payeeId} disabled={readOnly || autoSelecting} onChange={(event) => handlePayeeChange(event.target.value)}>
            <option value="">Select approved payee</option>
            {compatiblePeople.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
          </select>
        </label>
        <label className="text-sm">Unit
          <select className="input mt-1" value={vehicleId} disabled={readOnly || autoSelecting} onChange={(event) => handleVehicleChange(event.target.value)}>
            <option value="">Auto-select exact unit</option>
            {view.options.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.label}</option>)}
          </select>
        </label>
        <label className="text-sm">Period start<input className="input mt-1" type="date" value={periodStart} disabled={readOnly} onChange={(event) => setPeriodStart(event.target.value)} /></label>
        <label className="text-sm">Period end<input className="input mt-1" type="date" value={periodEnd} disabled={readOnly} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
        <label className="text-sm">Fuel policy
          <select className="input mt-1" value={fuelPolicy} disabled={readOnly} onChange={(event) => setFuelPolicy(event.target.value as FuelPolicy)}>
            <option value="transaction_date_in_period">Transaction date in period</option>
            <option value="fuel_report_period">Source fuel-report period</option>
            <option value="manual_reviewed_selection">Manual product-line selection</option>
            <option value="no_fuel">No fuel deduction</option>
          </select>
        </label>
        <label className="text-sm">Language
          <select className="input mt-1" value={languageMode} disabled={readOnly} onChange={(event) => setLanguageMode(event.target.value as LanguageMode)}>
            {view.options.languages.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
          </select>
        </label>
        <label className="text-sm">Template
          <select className="input mt-1" value={templateVersion} disabled={readOnly} onChange={(event) => setTemplateVersion(event.target.value)}>
            {view.options.templates.map((template) => <option key={template.version} value={template.version}>{template.label}</option>)}
          </select>
        </label>
      </section>
      <section className="card space-y-2">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="font-semibold">Automatic source selection</h3>
            <p className="text-sm text-slate-500">Trips CSV driver mappings and approved unit/fuel assignments are used. Ambiguous or unmatched rows stay unselected.</p>
          </div>
          <button className="btn-ghost" type="button" disabled={readOnly || autoSelecting || !statementType || !payeeId} onClick={() => void applyAutomaticSelection(statementType, payeeId, vehicleId)}>
            {autoSelecting ? "Matching..." : "Reapply exact matches"}
          </button>
        </div>
      </section>
      <SourceTable
        title="Revenue sources"
        rows={compatibleRevenue}
        selected={selectedRevenue}
        readOnly={readOnly || autoSelecting}
        onSelect={setSelectedRevenue}
      />
      <FuelTable
        rows={compatibleFuel}
        selected={selectedFuel}
        readOnly={readOnly || fuelPolicy === "no_fuel" || autoSelecting}
        onSelect={setSelectedFuel}
      />
      <section className="card space-y-3">
        <h3 className="font-semibold">Adjustments</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {adjustments.map((adjustment, index) => (
            <div key={adjustment.type} className="rounded border border-slate-200 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={adjustment.enabled} disabled={readOnly} onChange={(event) => updateAdjustment(index, { enabled: event.target.checked })} />
                {adjustment.label}
              </label>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {adjustment.basis === "gross_percentage" ? (
                  <label className="text-xs text-slate-500">Percent<input className="input mt-1" value={adjustment.rate} disabled={readOnly || !adjustment.enabled} onChange={(event) => updateAdjustment(index, { rate: event.target.value })} /></label>
                ) : (
                  <label className="text-xs text-slate-500">Amount<input className="input mt-1" value={adjustment.amount} disabled={readOnly || !adjustment.enabled} onChange={(event) => updateAdjustment(index, { amount: event.target.value })} /></label>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="card space-y-3">
        <h3 className="font-semibold">Calculation</h3>
        {preview ? (
          <div className="grid gap-2 md:grid-cols-4">
            <Metric label="Gross" value={usd(preview.gross)} />
            <Metric label="Deductions" value={usd(preview.totalDeductions)} />
            <Metric label="Fuel" value={usd(preview.fuelDeductions)} />
            <Metric label="Net" value={usd(preview.net)} />
          </div>
        ) : <p className="text-sm text-slate-500">Run Recalculate to preview server-computed totals.</p>}
        {preview?.lineItems?.length ? (
          <ul className="divide-y divide-slate-100 rounded border border-slate-200">
            {preview.lineItems.map((line) => <li key={line.key} className="flex justify-between p-2 text-sm"><span>{line.label}</span><span>{usd(line.amount)}</span></li>)}
          </ul>
        ) : null}
        {preview?.blockers.length ? <WorkflowActionResult type="error" message={`Blockers: ${preview.blockers.join(", ")}`} /> : null}
        {preview?.warnings.length ? <WorkflowActionResult type="info" message={`Warnings: ${preview.warnings.join(", ")}`} /> : null}
      </section>
      <div className="card flex flex-wrap gap-2">
        <button className="btn-ghost" type="button" disabled={readOnly || pending || autoSelecting} onClick={recalculate}>Recalculate</button>
        <button className="btn-primary" type="button" disabled={readOnly || pending || autoSelecting} onClick={save}>Save Draft</button>
        <button className="btn-ghost" type="button" disabled={!view.candidateId || readOnly || pending || autoSelecting} onClick={approve}>Approve Ready</button>
        <button className="btn-primary" type="button" disabled={!view.candidateId || view.status !== "ready" || pending || autoSelecting} onClick={convert}>Convert to Settlement</button>
        {view.candidateId ? <a className="btn-ghost" href={`/api/settlements/amazon-imports/candidates/${view.candidateId}/statement`} target="_blank" rel="noreferrer">Preview PDF</a> : null}
        <button className="btn-ghost" type="button" disabled={!view.candidateId || readOnly || pending || autoSelecting} onClick={archive}>Archive</button>
      </div>
    </div>
  );

  function updateAdjustment(index: number, patch: Partial<AdjustmentState>) {
    setAdjustments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }
}

function SourceTable({ title, rows, selected, readOnly, onSelect }: {
  title: string;
  rows: EditorView["revenueSources"];
  selected: string[];
  readOnly: boolean;
  onSelect: (value: string[]) => void;
}) {
  const selectedSet = new Set(selected);
  const total = rows.filter((row) => selectedSet.has(row.revenueItemId)).reduce((sum, row) => sum + row.grossAmount, 0);
  return (
    <section className="card overflow-x-auto p-0">
      <div className="flex items-center justify-between p-4">
        <div><h3 className="font-semibold">{title}</h3><p className="text-sm text-slate-500">{selected.length} selected, {usd(total)}</p></div>
        <button className="btn-ghost" type="button" disabled={readOnly} onClick={() => onSelect(rows.map((row) => row.revenueItemId))}>Select all visible (manual)</button>
      </div>
      <table className="w-full min-w-[980px]"><tbody>{rows.map((row) => (
        <tr key={row.revenueItemId} className="border-t border-slate-100">
          <td className="td"><input type="checkbox" disabled={readOnly} checked={selectedSet.has(row.revenueItemId)} onChange={() => toggle(row.revenueItemId, selected, onSelect)} /></td>
          <td className="td">{row.serviceDateRange}</td><td className="td">{row.routeDisplay}</td><td className="td">{row.unitDisplay}</td>
          <td className="td text-right">{row.miles ?? "-"}</td><td className="td text-right">{usd(row.baseAmount)}</td><td className="td text-right">{usd(row.fuelSurchargeAmount)}</td>
          <td className="td text-right">{usd(row.tollAmount)}</td><td className="td text-right">{usd(row.detentionAmount)}</td><td className="td text-right">{usd(row.tonuAmount)}</td><td className="td text-right">{usd(row.otherAmount)}</td><td className="td text-right">{usd(row.grossAmount)}</td>
          <td className="td">{row.projectionStatus}</td><td className="td">{row.settlementEligible ? "Eligible" : "Pending"}</td>
        </tr>
      ))}</tbody></table>
    </section>
  );
}

function FuelTable({ rows, selected, readOnly, onSelect }: {
  rows: EditorView["fuelSources"];
  selected: string[];
  readOnly: boolean;
  onSelect: (value: string[]) => void;
}) {
  const selectedSet = new Set(selected);
  const total = rows.filter((row) => selectedSet.has(row.transactionLineId)).reduce((sum, row) => sum + row.chargedAmount, 0);
  return (
    <section className="card overflow-x-auto p-0">
      <div className="flex items-center justify-between p-4">
        <div><h3 className="font-semibold">Fuel product lines</h3><p className="text-sm text-slate-500">{selected.length} selected, {usd(total)}. Discounts are informational only.</p></div>
        <button className="btn-ghost" type="button" disabled={readOnly} onClick={() => onSelect(rows.map((row) => row.transactionLineId))}>Select all visible (manual)</button>
      </div>
      <table className="w-full min-w-[860px]"><tbody>{rows.map((row) => (
        <tr key={row.transactionLineId} className="border-t border-slate-100">
          <td className="td"><input type="checkbox" disabled={readOnly || row.placeholder} checked={selectedSet.has(row.transactionLineId)} onChange={() => toggle(row.transactionLineId, selected, onSelect)} /></td>
          <td className="td">{row.transactionDate ?? "-"}</td><td className="td">{row.maskedTransactionReference}</td><td className="td">{row.product}</td>
          <td className="td text-right">{row.quantity ?? "-"}</td><td className="td text-right">{usd(row.chargedAmount)}</td><td className="td text-right">{row.discountAmount == null ? "-" : usd(row.discountAmount)}</td>
          <td className="td">{row.assignmentStatus}</td><td className="td">{row.deductionReady ? "Ready" : "Projected only"}</td>
        </tr>
      ))}</tbody></table>
    </section>
  );
}

function toggle(id: string, selected: string[], onSelect: (value: string[]) => void) {
  onSelect(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded border border-slate-200 bg-slate-50 p-3"><div className="text-xs text-slate-500">{label}</div><div className="font-semibold">{value}</div></div>;
}

function personMatchesStatement(type: string, statementType: StatementType) {
  if (statementType === "owner_operator") return type === "owner_operator";
  if (statementType === "managed_investor") return type === "investor";
  return type === "company_driver" || type === "external_carrier_driver";
}

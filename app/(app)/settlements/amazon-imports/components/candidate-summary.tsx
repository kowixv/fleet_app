"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { shortDate, usd } from "@/lib/format";
import AmazonImportStatusBadge from "./amazon-import-status-badge";
import WorkflowActionResult from "./workflow-action-result";
import {
  approveAmazonCandidateAction,
  archiveAmazonCandidateAction,
  convertAmazonCandidateAction,
} from "../actions";

type CandidateView = {
  id: string;
  statementType: string;
  period: string;
  payeeDisplay: string;
  unitDisplay: string;
  selectedRevenueCount: number;
  gross: number;
  selectedFuelAmount: number;
  totalDeductions: number;
  net: number;
  status: string;
  blockingIssueCount: number;
  warningCount: number;
  templateVersion: string;
  calculationRevision: string;
  previewRevision: string;
  approvedAt: string | null;
  lastCalculatedAt: string | null;
  settlementId: string | null;
};

export default function CandidateSummary({
  batchId,
  candidates,
  canMutate,
}: {
  batchId: string;
  candidates: CandidateView[];
  canMutate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState<{ type: "ok" | "error" | "info"; text: string } | null>(null);
  const filtered = candidates.filter((candidate) => filter === "all" || candidate.status === filter || candidate.statementType === filter);

  function approve(candidate: CandidateView) {
    if (!confirm("Approve this candidate as Ready? The server will enforce readiness and stale-preview checks.")) return;
    runCandidateAction(() => approveAmazonCandidateAction({ candidateId: candidate.id, expectedPreviewRevision: candidate.previewRevision }), "Candidate approved Ready.");
  }

  function archive(candidate: CandidateView) {
    if (!confirm("Archive this candidate? Converted candidates cannot be archived.")) return;
    runCandidateAction(() => archiveAmazonCandidateAction({ candidateId: candidate.id, expectedPreviewRevision: candidate.previewRevision }), "Candidate archived.");
  }

  function convert(candidate: CandidateView) {
    if (!confirm("Convert this Ready candidate to a settlement through the atomic Amazon conversion RPC?")) return;
    runCandidateAction(() => convertAmazonCandidateAction({ candidateId: candidate.id, expectedPreviewRevision: candidate.previewRevision }), "Candidate converted to settlement.");
  }

  function runCandidateAction(action: () => Promise<{ ok: true; data: unknown } | { ok: false; error: { message: string } }>, okText: string) {
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

  return (
    <section className="card p-0">
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-semibold">Candidates</h2>
          <p className="text-sm text-slate-500">Create and edit candidates with reviewed source selections, payee, statement type, fuel policy, and adjustments.</p>
        </div>
        <Link className={canMutate ? "btn-primary" : "btn-ghost pointer-events-none opacity-50"} href={`/settlements/amazon-imports/${batchId}/candidates/new`}>
          Create Candidate
        </Link>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        {["all", "draft", "needs_review", "ready", "stale", "converted", "archived", "owner_operator", "company_driver", "box_truck_driver", "managed_investor"].map((value) => (
          <button
            key={value}
            type="button"
            className={filter === value ? "btn-primary" : "btn-ghost"}
            onClick={() => setFilter(value)}
          >
            {value.replace(/_/g, " ")}
          </button>
        ))}
      </div>
      {!canMutate ? <div className="px-4 pb-4"><WorkflowActionResult type="info" message="Read-only access. Viewer users cannot create, approve, archive, or convert candidates." /></div> : null}
      {message ? <div className="px-4 pb-4"><WorkflowActionResult type={message.type} message={message.text} /></div> : null}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[860px]">
        <thead className="border-y border-slate-200 bg-slate-50">
          <tr>
            <th className="th">Statement type</th>
            <th className="th">Period</th>
            <th className="th">Payee</th>
            <th className="th">Unit</th>
            <th className="th text-right">Revenue</th>
            <th className="th text-right">Fuel</th>
            <th className="th text-right">Gross</th>
            <th className="th text-right">Deductions</th>
            <th className="th text-right">Net</th>
            <th className="th">Status</th>
            <th className="th text-right">Blockers</th>
            <th className="th text-right">Warnings</th>
            <th className="th">Template</th>
            <th className="th">Calculated</th>
            <th className="th">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <tr><td className="td text-slate-400" colSpan={16}>No statement candidates yet.</td></tr>
          ) : filtered.map((candidate) => (
            <tr key={candidate.id}>
              <td className="td">{candidate.statementType.replace(/_/g, " ")}</td>
              <td className="td">{candidate.period}</td>
              <td className="td">{candidate.payeeDisplay}</td>
              <td className="td">{candidate.unitDisplay}</td>
              <td className="td text-right">{candidate.selectedRevenueCount}</td>
              <td className="td text-right">{usd(candidate.selectedFuelAmount)}</td>
              <td className="td text-right">{usd(candidate.gross)}</td>
              <td className="td text-right">{usd(candidate.totalDeductions)}</td>
              <td className="td text-right font-semibold">{usd(candidate.net)}</td>
              <td className="td"><AmazonImportStatusBadge status={candidate.status} /></td>
              <td className="td text-right">{candidate.blockingIssueCount}</td>
              <td className="td text-right">{candidate.warningCount}</td>
              <td className="td">{candidate.templateVersion}</td>
              <td className="td">{shortDate(candidate.lastCalculatedAt)}</td>
              <td className="td">
                <div className="flex min-w-[260px] flex-wrap justify-end gap-2">
                  <a className="btn-ghost" href={`/api/settlements/amazon-imports/candidates/${candidate.id}/statement`} target="_blank" rel="noreferrer">
                    {candidate.status === "converted" ? "Download Final Statement" : "Preview Statement"}
                  </a>
                  {candidate.settlementId ? <Link className="btn-ghost" href={`/settlements/${candidate.settlementId}`}>Settlement</Link> : null}
                  <Link className="btn-ghost" href={`/settlements/amazon-imports/${batchId}/candidates/${candidate.id}`}>Open/Edit</Link>
                  <button className="btn-ghost" type="button" disabled={!canMutate || pending || candidate.status === "converted" || candidate.status === "archived"} onClick={() => approve(candidate)}>Approve Ready</button>
                  <button className="btn-primary" type="button" disabled={!canMutate || pending || candidate.status !== "ready"} onClick={() => convert(candidate)}>Convert</button>
                  <button className="btn-ghost" type="button" disabled={!canMutate || pending || candidate.status === "converted" || candidate.status === "archived"} onClick={() => archive(candidate)}>Archive</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}

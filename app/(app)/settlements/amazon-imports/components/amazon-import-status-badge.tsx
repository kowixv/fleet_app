const STATUS_CLASSES: Record<string, string> = {
  uploaded: "bg-slate-100 text-slate-700",
  parsing: "bg-blue-100 text-blue-700",
  parsed: "bg-blue-100 text-blue-700",
  needs_review: "bg-amber-100 text-amber-800",
  reconciled: "bg-emerald-100 text-emerald-700",
  ready: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  archived: "bg-slate-200 text-slate-600",
  passed: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-800",
  blocked: "bg-red-100 text-red-700",
  not_started: "bg-slate-100 text-slate-500",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
};

export default function AmazonImportStatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STATUS_CLASSES[status] ?? "bg-slate-100 text-slate-700"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

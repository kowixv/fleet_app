export default function WorkflowActionResult({
  type,
  message,
}: {
  type: "ok" | "error" | "info";
  message: string;
}) {
  const tone = type === "ok"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : type === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <p role={type === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${tone}`}>
      {message}
    </p>
  );
}

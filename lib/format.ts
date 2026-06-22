export function usd(n: number | null | undefined): string {
  const v = typeof n === "number" ? n : 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function pct(fraction: number | null | undefined): string {
  const v = typeof fraction === "number" ? fraction : 0;
  return `${(v * 100).toFixed(0)}%`;
}

export function shortDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

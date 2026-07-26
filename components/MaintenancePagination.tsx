import Link from "next/link";

export default function MaintenancePagination({
  totalCount,
  shownCount,
  nextHref,
  label = "kayıt",
}: {
  totalCount: number;
  shownCount: number;
  nextHref: string | null;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
      <span className="text-slate-500">
        Toplam {totalCount.toLocaleString("tr-TR")} {label} · bu sayfada {shownCount}
      </span>
      {nextHref ? (
        <Link className="btn-ghost" href={nextHref}>Daha eski kayıtlar</Link>
      ) : (
        <span className="text-slate-400">Tüm eski kayıtlar gösterildi.</span>
      )}
    </div>
  );
}

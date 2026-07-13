"use client";

import MaintenanceNav from "@/components/MaintenanceNav";

export default function MaintenanceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        <h2 className="font-semibold">Bakım bilgileri yüklenemedi.</h2>
        <p className="mt-1">{error.message || "Lütfen tekrar deneyin."}</p>
        <button type="button" className="btn-primary mt-4" onClick={reset}>
          Tekrar dene
        </button>
      </div>
    </div>
  );
}

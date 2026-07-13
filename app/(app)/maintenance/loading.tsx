import MaintenanceNav from "@/components/MaintenanceNav";

export default function MaintenanceLoading() {
  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Bakım bilgileri yükleniyor...
      </div>
    </div>
  );
}

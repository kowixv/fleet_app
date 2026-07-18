export default function LoadingAmazonImportBatch() {
  return (
    <div className="space-y-4">
      <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-64 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}

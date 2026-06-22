import ImportedInbox from "@/components/ImportedInbox";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ImportedPage() {
  const supabase = await createClient();
  const { data: pending } = await supabase
    .from("imported_loads")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Telegram Yükleri</h1>
        <p className="text-sm text-slate-500">
          Gruplardan gelen yükler burada onay bekler. Onaylanınca resmi Load kaydı oluşur.
        </p>
      </div>
      <ImportedInbox rows={pending ?? []} />
    </div>
  );
}

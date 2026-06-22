import ResourceManager, { Field } from "@/components/ResourceManager";
import { createClient } from "@/lib/supabase/server";
import { fetchRows, fetchOptions } from "@/lib/data";
import { updateSettings } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const [{ data: settings }, groups, opts] = await Promise.all([
    supabase.from("settings").select("*").single(),
    fetchRows("telegram_groups"),
    fetchOptions(),
  ]);

  const groupFields: Field[] = [
    { name: "chat_id", label: "Telegram Chat ID", required: true },
    { name: "title", label: "Grup Adı" },
    { name: "vehicle_id", label: "Araç", type: "select", options: opts.vehicles },
    { name: "driver_id", label: "Şoför", type: "select", options: opts.drivers },
    { name: "company_id", label: "Şirket", type: "select", options: opts.companies, hideInTable: true },
    { name: "active", label: "Aktif", type: "checkbox" },
  ];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://YOUR-APP.vercel.app";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Settings</h1>

      <div className="card">
        <h2 className="mb-3 font-semibold">Hesaplama &amp; Uyarı Eşikleri</h2>
        <form action={updateSettings} className="grid max-w-2xl grid-cols-2 gap-3">
          <div>
            <label className="label">Varsayılan Komisyon ($)</label>
            <input name="default_commission" type="number" step="0.01" defaultValue={settings?.default_commission ?? 250} className="input" />
          </div>
          <div>
            <label className="label">PM "Due Soon" eşiği (mil)</label>
            <input name="pm_due_soon_miles" type="number" defaultValue={settings?.pm_due_soon_miles ?? 2500} className="input" />
          </div>
          <div>
            <label className="label">Repair uyarı tutarı ($)</label>
            <input name="repair_warning_amount" type="number" step="0.01" defaultValue={settings?.repair_warning_amount ?? 5000} className="input" />
          </div>
          <div>
            <label className="label">Fuel uyarı eşiği (% gross)</label>
            <input name="fuel_warning_pct" type="number" step="1" defaultValue={Math.round((settings?.fuel_warning_pct ?? 0.3) * 100)} className="input" />
          </div>
          <div className="col-span-2">
            <button type="submit" className="btn-primary">Kaydet</button>
          </div>
        </form>
      </div>

      <div>
        <h2 className="mb-2 font-semibold">Telegram Grupları</h2>
        <p className="mb-3 text-sm text-slate-500">
          Her grubu bir araç + şoför ile eşleyin. Gruba yazılan yükler o araca atanır.
        </p>
        <ResourceManager
          title=""
          table="telegram_groups"
          basePath="/settings"
          addLabel="Grup Eşle"
          fields={groupFields}
          rows={groups}
        />
      </div>

      <div className="card">
        <h2 className="mb-2 font-semibold">Telegram Bot Kurulumu</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>@BotFather ile bot oluşturun, token'ı <code>TELEGRAM_BOT_TOKEN</code>'a koyun.</li>
          <li>Botu her şoför grubuna ekleyin (admin yapın ki mesajları görsün).</li>
          <li>Webhook'u bağlayın:</li>
        </ol>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
{`curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \\
  -d "url=${appUrl}/api/telegram/webhook" \\
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"`}
        </pre>
        <p className="mt-2 text-sm text-slate-500">
          Bir gruptaki Chat ID'yi öğrenmek için botu ekleyip gruba mesaj atın; bot yanıtında Chat ID görünür.
        </p>
      </div>
    </div>
  );
}

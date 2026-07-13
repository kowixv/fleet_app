import ResourceManager, { Field } from "@/components/ResourceManager";
import TabletManagement from "@/components/TabletManagement";
import TelegramConnect from "@/components/TelegramConnect";
import { fetchOptions, fetchRows } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { updateSettings } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const [{ data: settings }, groups, opts, { data: vehicles }] = await Promise.all([
    supabase.from("settings").select("*").single(),
    fetchRows("telegram_groups"),
    fetchOptions(),
    supabase
      .from("vehicles")
      .select("id, unit_number")
      .eq("status", "active")
      .order("unit_number"),
  ]);

  const groupFields: Field[] = [
    { name: "chat_id", label: "Telegram Chat ID", required: true },
    { name: "title", label: "Grup Adi" },
    { name: "vehicle_id", label: "Arac", type: "select", options: opts.vehicles },
    { name: "driver_id", label: "Sofor", type: "select", options: opts.drivers },
    { name: "company_id", label: "Sirket", type: "select", options: opts.companies, hideInTable: true },
    { name: "active", label: "Aktif", type: "checkbox" },
  ];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://fleet-app-olive.vercel.app";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Settings</h1>

      <div className="card">
        <h2 className="mb-3 font-semibold">Hesaplama ve Uyari Esikleri</h2>
        <form action={updateSettings} className="grid max-w-2xl grid-cols-2 gap-3">
          <div>
            <label className="label">Varsayilan Komisyon ($)</label>
            <input name="default_commission" type="number" step="0.01" defaultValue={settings?.default_commission ?? 250} className="input" />
          </div>
          <div>
            <label className="label">PM Due Soon (mil)</label>
            <input name="pm_due_soon_miles" type="number" defaultValue={settings?.pm_due_soon_miles ?? 2000} className="input" />
          </div>
          <div>
            <label className="label">PM Due Soon (gun)</label>
            <input name="pm_due_soon_days" type="number" min="1" step="1" defaultValue={settings?.pm_due_soon_days ?? 7} className="input" />
          </div>
          <div>
            <label className="label">PM Due Soon (engine hours)</label>
            <input name="pm_due_soon_engine_hours" type="number" min="1" step="1" defaultValue={settings?.pm_due_soon_engine_hours ?? 100} className="input" />
          </div>
          <div>
            <label className="label">Repair uyari tutari ($)</label>
            <input name="repair_warning_amount" type="number" step="0.01" defaultValue={settings?.repair_warning_amount ?? 5000} className="input" />
          </div>
          <div>
            <label className="label">Invoice allocation tolerance ($)</label>
            <input name="maintenance_invoice_allocation_tolerance" type="number" step="0.01" min="0" defaultValue={settings?.maintenance_invoice_allocation_tolerance ?? 1} className="input" />
          </div>
          <div>
            <label className="label">Fuel uyari esigi (% gross)</label>
            <input name="fuel_warning_pct" type="number" step="1" defaultValue={Math.round((settings?.fuel_warning_pct ?? 0.3) * 100)} className="input" />
          </div>
          <div className="col-span-2">
            <button type="submit" className="btn-primary">Kaydet</button>
          </div>
        </form>
      </div>

      <TelegramConnect />

      <div className="card">
        <TabletManagement vehicles={vehicles ?? []} />
      </div>

      <div>
        <h2 className="mb-2 font-semibold">Bagli Telegram Sohbetleri</h2>
        <p className="mb-3 text-sm text-slate-500">
          Telegram'i Bagla ile eklenen sohbetler burada gorunur. Her birine varsayilan arac, sofor veya sirket atanabilir.
        </p>
        <ResourceManager
          title=""
          table="telegram_groups"
          basePath="/settings"
          addLabel="Elle Ekle"
          fields={groupFields}
          rows={groups}
        />
      </div>

      <div className="card">
        <h2 className="mb-2 font-semibold">Ilk Kurulum</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>@BotFather ile bot olusturun ve token'i <code>TELEGRAM_BOT_TOKEN</code> olarak ekleyin.</li>
          <li>Botu gruba ekleyip admin yapin.</li>
          <li>Webhook'u baglayin:</li>
        </ol>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
{`curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \\
  -d "url=${appUrl}/api/telegram/webhook" \\
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"`}
        </pre>
      </div>
    </div>
  );
}

import { createServiceClient } from "@/lib/supabase/server";
import { computePM } from "@/lib/maintenance";
import { sendMessage, escapeHtml } from "@/lib/telegram";
import { safeEqual, secretMisconfigured } from "@/lib/secure";

export const runtime = "nodejs";

/** Daily PM check. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Fail closed in production if the secret is not configured.
  if (secretMisconfigured(secret)) {
    return new Response("server misconfigured", { status: 500 });
  }
  if (secret) {
    const header = req.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!safeEqual(token, secret)) {
      return new Response("unauthorized", { status: 401 });
    }
  }

  const supabase = createServiceClient();

  const [{ data: rules }, { data: settingsRows }, { data: groups }] = await Promise.all([
    supabase
      .from("maintenance_rules")
      .select("*, vehicles!maintenance_rules_vehicle_id_fkey(id, unit_number, current_mileage)")
      .eq("active", true),
    supabase.from("settings").select("organization_id, pm_due_soon_miles"),
    supabase.from("telegram_groups").select("chat_id, vehicle_id, active"),
  ]);

  const dueSoonByOrg = new Map<string, number>();
  for (const s of settingsRows ?? [])
    dueSoonByOrg.set(s.organization_id, s.pm_due_soon_miles ?? 2500);

  const chatsByVehicle = new Map<string, string[]>();
  for (const g of groups ?? []) {
    if (!g.active || !g.vehicle_id) continue;
    const arr = chatsByVehicle.get(g.vehicle_id) ?? [];
    arr.push(g.chat_id);
    chatsByVehicle.set(g.vehicle_id, arr);
  }

  // Aggregate alert lines per chat
  const linesByChat = new Map<string, string[]>();
  let alerts = 0;

  for (const r of rules ?? []) {
    const vehicle = (r as any).vehicles;
    if (!vehicle) continue;
    const dueSoon = dueSoonByOrg.get(r.organization_id) ?? 2500;
    const pm = computePM(r, vehicle.current_mileage ?? 0, dueSoon);
    if (pm.status === "ok") continue;

    const unitTxt = pm.unit === "miles" ? "mi" : "gun";
    const line = `• Unit ${escapeHtml(vehicle.unit_number)} — ${escapeHtml(r.service_type)}: ${escapeHtml(pm.label)} (${pm.remaining ?? "?"} ${unitTxt} kaldi)`;
    alerts++;

    for (const chat of chatsByVehicle.get(vehicle.id) ?? []) {
      const arr = linesByChat.get(chat) ?? [];
      arr.push(line);
      linesByChat.set(chat, arr);
    }
  }

  for (const [chat, lines] of linesByChat) {
    await sendMessage(chat, `🔧 <b>Bakim Uyarisi</b>\n${lines.join("\n")}`);
  }

  return Response.json({ ok: true, alerts, chatsNotified: linesByChat.size });
}

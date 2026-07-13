import { createServiceClient } from "@/lib/supabase/server";
import { computePM, formatPMWhichever } from "@/lib/maintenance";
import { sendMessage, escapeHtml } from "@/lib/telegram";
import { safeEqual, secretMisconfigured } from "@/lib/secure";
import { todayISO } from "@/lib/tz";

export const runtime = "nodejs";

/** Daily PM check. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secretMisconfigured(secret)) return new Response("server misconfigured", { status: 500 });
  if (secret) {
    const header = req.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!safeEqual(token, secret)) return new Response("unauthorized", { status: 401 });
  }

  const supabase = createServiceClient();
  const [rulesResult, settingsResult, groupsResult, profilesResult] = await Promise.all([
    supabase
      .from("maintenance_rules")
      .select("*, vehicles!maintenance_rules_vehicle_id_fkey(id, unit_number, current_mileage)")
      .eq("active", true),
    supabase.from("settings").select("organization_id, pm_due_soon_miles, pm_due_soon_days, pm_due_soon_engine_hours"),
    supabase.from("telegram_groups").select("organization_id, chat_id, vehicle_id, active"),
    supabase.from("vehicle_maintenance_profiles").select("organization_id, vehicle_id, engine_hours"),
  ]);

  const queryError = rulesResult.error ?? settingsResult.error ?? groupsResult.error ?? profilesResult.error;
  if (queryError) {
    console.error("pm-check query failed", queryError);
    return Response.json({ ok: false, error: queryError.message }, { status: 500 });
  }

  const thresholdsByOrg = new Map<string, { dueSoonMiles: number; dueSoonDays: number; dueSoonEngineHours: number }>();
  for (const settings of settingsResult.data ?? []) {
    thresholdsByOrg.set(settings.organization_id, {
      dueSoonMiles: Number(settings.pm_due_soon_miles ?? 2_000),
      dueSoonDays: Number(settings.pm_due_soon_days ?? 7),
      dueSoonEngineHours: Number(settings.pm_due_soon_engine_hours ?? 100),
    });
  }

  const engineHoursByOrgVehicle = new Map<string, number | null>();
  for (const profile of profilesResult.data ?? []) {
    engineHoursByOrgVehicle.set(
      `${profile.organization_id}:${profile.vehicle_id}`,
      profile.engine_hours == null ? null : Number(profile.engine_hours),
    );
  }

  const chatsByOrgVehicle = new Map<string, string[]>();
  for (const group of groupsResult.data ?? []) {
    if (!group.active || !group.vehicle_id) continue;
    const key = `${group.organization_id}:${group.vehicle_id}`;
    const chats = chatsByOrgVehicle.get(key) ?? [];
    if (!chats.includes(group.chat_id)) chats.push(group.chat_id);
    chatsByOrgVehicle.set(key, chats);
  }

  const linesByChat = new Map<string, { chatId: string; lines: string[] }>();
  let alertsFound = 0;
  let alertsMapped = 0;

  for (const rule of rulesResult.data ?? []) {
    const vehicle = rule.vehicles as { id: string; unit_number: string; current_mileage: number | null } | null;
    if (!vehicle) continue;
    const thresholds = thresholdsByOrg.get(rule.organization_id) ?? { dueSoonMiles: 2_000, dueSoonDays: 7, dueSoonEngineHours: 100 };
    const pm = computePM(
      rule,
      Number(vehicle.current_mileage ?? 0),
      thresholds,
      todayISO(),
      engineHoursByOrgVehicle.get(`${rule.organization_id}:${vehicle.id}`) ?? null,
    );
    if (pm.status === "ok") continue;
    alertsFound++;

    const chats = chatsByOrgVehicle.get(`${rule.organization_id}:${vehicle.id}`) ?? [];
    if (chats.length === 0) continue;
    alertsMapped++;
    const line = `- Unit ${escapeHtml(vehicle.unit_number)} - ${escapeHtml(rule.service_type)}: ${escapeHtml(pm.label)} (${escapeHtml(formatPMWhichever(pm))})`;
    for (const chatId of chats) {
      const key = `${rule.organization_id}:${chatId}`;
      const group = linesByChat.get(key) ?? { chatId, lines: [] };
      group.lines.push(line);
      linesByChat.set(key, group);
    }
  }

  let messagesSent = 0;
  const failures: Array<{ chatId: string; error: string }> = [];
  for (const { chatId, lines } of linesByChat.values()) {
    try {
      await sendMessage(chatId, `🔧 <b>Bakım Uyarısı</b>\n${lines.join("\n")}`);
      messagesSent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ chatId, error: message });
      console.error("pm-check Telegram delivery failed", { chatId, message });
    }
  }

  const payload = {
    ok: failures.length === 0,
    alertsFound,
    alertsMapped,
    messagesSent,
    failures,
  };
  return Response.json(payload, { status: failures.length > 0 ? 502 : 200 });
}

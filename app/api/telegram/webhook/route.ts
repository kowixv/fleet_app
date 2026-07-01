import { createServiceClient } from "@/lib/supabase/server";
import {
  sendMessage,
  editMessageText,
  editMessageReplyMarkup,
  answerCallbackQuery,
  approveKeyboard,
  vehicleKeyboard,
  confirmKeyboard,
  downloadFile,
  escapeHtml,
} from "@/lib/telegram";
import { parseLoad } from "@/lib/parse";
import { usd } from "@/lib/format";
import { safeEqual, secretMisconfigured } from "@/lib/secure";
import {
  detectIntent,
  computeMissing,
  type BotIntent,
} from "@/lib/bot-intent";
import {
  executeCommand,
  prepareSettlement,
  type PendingCommand,
} from "@/lib/bot-executor";
import { geocodeAndActivateTracking } from "@/lib/tracking/activate";

export const runtime = "nodejs";

type AuthResult = "ok" | "unauthorized" | "misconfigured";

function authorize(req: Request): AuthResult {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  // Fail closed in production if the secret is not configured.
  if (secretMisconfigured(secret)) return "misconfigured";
  if (!secret) return "ok"; // allow if unset (dev only)
  return safeEqual(req.headers.get("x-telegram-bot-api-secret-token"), secret)
    ? "ok"
    : "unauthorized";
}

export async function POST(req: Request) {
  const auth = authorize(req);
  if (auth === "misconfigured") return new Response("server misconfigured", { status: 500 });
  if (auth === "unauthorized") return new Response("unauthorized", { status: 401 });

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("ok");
  }
  const supabase = createServiceClient();

  try {
    if (update.callback_query) {
      await handleCallback(supabase, update.callback_query);
    } else if (update.message) {
      await handleMessage(supabase, update.message);
    }
  } catch (e) {
    console.error("telegram webhook error", e);
  }
  // Always 200 so Telegram doesn't retry-storm.
  return new Response("ok");
}

/**
 * Bot commands. Handled for both private and group chats, and BEFORE the
 * org-mapping check so `/start <code>` and `/pair <code>` work on a chat that
 * isn't linked yet. Returns true when the command was handled.
 */
async function handleCommand(
  supabase: any,
  chatId: string,
  text: string,
  _isPrivate: boolean,
  chatTitle: string | null,
): Promise<boolean> {
  const [cmdRaw, ...rest] = text.trim().split(/\s+/);
  // In groups Telegram sends "/pair@botname"; strip the @mention suffix.
  const cmd = cmdRaw.toLowerCase().split("@")[0];
  const arg = rest.join(" ").trim();

  if (cmd === "/start") {
    if (arg) {
      await consumePairingCode(supabase, arg, chatId, chatTitle);
    } else {
      await sendMessage(
        chatId,
        `Merhaba! 👋\n\nBu sohbeti hesabınıza bağlamak için uygulamada <b>Settings → Telegram'ı Bağla</b>'ya gidin; oradaki bağlantıya dokunun veya kodu <code>/pair KOD</code> ile gönderin.\n\nBağladıktan sonra doğal dille komut yazabilir, dosya/metin ile yük ekleyebilirsiniz.\n\n/help — örnek komutlar`,
      );
    }
    return true;
  }

  if (cmd === "/pair") {
    if (!arg) {
      await sendMessage(chatId, `Kullanım: <code>/pair KOD</code>\nKodu uygulamada <b>Settings → Telegram'ı Bağla</b>'dan alın.`);
    } else {
      await consumePairingCode(supabase, arg, chatId, chatTitle);
    }
    return true;
  }

  if (cmd === "/myid") {
    await sendMessage(chatId, `Chat ID: <code>${escapeHtml(chatId)}</code>`);
    return true;
  }

  if (cmd === "/help") {
    await sendMessage(chatId, helpText());
    return true;
  }

  return false;
}

/**
 * Bind the current chat to an org using a pairing code (created in the web app).
 * Validates the code is unused + unexpired and protects against rebinding a chat
 * that already belongs to a different organization.
 */
async function consumePairingCode(
  supabase: any,
  rawCode: string,
  chatId: string,
  chatTitle: string | null,
): Promise<void> {
  const code = rawCode.trim().toUpperCase();
  const { data: pc } = await supabase
    .from("telegram_pairing_codes")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (!pc || pc.used_at || new Date(pc.expires_at) <= new Date()) {
    await sendMessage(chatId, `❌ Kod geçersiz veya süresi dolmuş.\nUygulamadan yeni bir kod oluşturun (Settings → Telegram'ı Bağla).`);
    return;
  }

  const { data: existing } = await supabase
    .from("telegram_groups")
    .select("id, organization_id")
    .eq("chat_id", chatId)
    .maybeSingle();

  if (existing && existing.organization_id !== pc.organization_id) {
    await sendMessage(chatId, `⚠️ Bu sohbet zaten başka bir hesaba bağlı.`);
    return;
  }

  if (existing) {
    await supabase
      .from("telegram_groups")
      .update({ active: true, ...(chatTitle ? { title: chatTitle } : {}) })
      .eq("id", existing.id);
  } else {
    await supabase.from("telegram_groups").insert({
      organization_id: pc.organization_id,
      chat_id: chatId,
      title: chatTitle,
      active: true,
    });
  }

  await supabase.from("telegram_pairing_codes").update({ used_at: new Date().toISOString() }).eq("code", pc.code);
  await sendMessage(
    chatId,
    `✅ <b>Bağlandı!</b>\nArtık doğal dille komut yazabilir, dosya/metin göndererek yük ekleyebilirsiniz.\n\n/help — örnek komutlar`,
  );
}

async function handleMessage(supabase: any, message: any) {
  const chatId = String(message.chat.id);
  const isPrivate = message.chat.type === "private";
  const text: string | undefined = message.caption || message.text || undefined;

  const chatTitle: string | null = message.chat.title ?? message.chat.username ?? null;

  // Bot commands (/start, /pair, /myid, /help) — handled for BOTH private and
  // group chats, before the mapping check, so pairing works on an unmapped chat.
  if (text && text.trim().startsWith("/")) {
    const handled = await handleCommand(supabase, chatId, text, isPrivate, chatTitle);
    if (handled) return;
  }

  const { data: group } = await supabase
    .from("telegram_groups")
    .select("*")
    .eq("chat_id", chatId)
    .maybeSingle();

  if (!group || !group.active) {
    await sendMessage(
      chatId,
      `Bu sohbet henüz hesabınıza bağlı değil.\n\nUygulamada <b>Settings → Telegram'ı Bağla</b>'dan bir kod alın; özelde bağlantıya dokunun ya da burada <code>/pair KOD</code> yazın.`,
    );
    return;
  }

  const hasFile = !!(message.document || message.photo?.length);

  // Natural-language management commands (private + group). A file is always a
  // load, so only text (no file) is routed to intent detection. Returns true
  // when fully handled; false means fall through to the load pipeline below
  // (add_load, unknown-in-group, or when the AI backend is unavailable).
  if (!hasFile && text) {
    const handled = await handleChatIntent(supabase, group, chatId, text, isPrivate);
    if (handled) return;
  }

  // Determine media
  let fileId: string | null = null;
  let sourceType = "text";
  if (message.document) {
    fileId = message.document.file_id;
    sourceType = message.document.mime_type === "application/pdf" ? "pdf" : "photo";
  } else if (message.photo?.length) {
    fileId = message.photo[message.photo.length - 1].file_id; // largest
    sourceType = "photo";
  }

  let fileUrl: string | null = null;
  let fileForParse: { base64: string; mime: string } | undefined;

  if (fileId) {
    const file = await downloadFile(fileId);
    if (file) {
      const path = `${group.organization_id}/${chatId}-${message.message_id}.${file.ext}`;
      await supabase.storage.from("imports").upload(path, file.bytes, {
        contentType: file.mime,
        upsert: true,
      });
      fileUrl = path;
      fileForParse = { base64: file.bytes.toString("base64"), mime: file.mime };
    }
  }

  if (!fileForParse && !text) return; // nothing to parse

  const parsed = await parseLoad({ text, file: fileForParse });

  const { data: imported, error: importError } = await supabase
    .from("imported_loads")
    .insert({
      organization_id: group.organization_id,
      telegram_group_id: group.id,
      chat_id: chatId,
      message_id: String(message.message_id),
      source_type: sourceType,
      raw_text: text ?? null,
      file_url: fileUrl,
      extracted: parsed ?? null,
      load_number: parsed?.load_number ?? null,
      broker_name: parsed?.broker_name ?? null,
      driver_name: parsed?.driver_name ?? null,
      pickup_date: parsed?.pickup_date ?? null,
      pickup_location: parsed?.pickup_location ?? null,
      delivery_date: parsed?.delivery_date ?? null,
      delivery_location: parsed?.delivery_location ?? null,
      total_miles: parsed?.total_miles ?? null,
      gross_rate: parsed?.gross_rate ?? null,
      status: "pending",
    })
    .select("id")
    .single();

  if (importError?.code === "23505") return;
  if (importError) throw new Error(importError.message);

  // Private chat with no vehicle assigned: ask which vehicle this load belongs to.
  if (isPrivate && !group.vehicle_id && imported) {
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id, unit_number")
      .eq("organization_id", group.organization_id)
      .eq("status", "active")
      .order("unit_number");

    if (vehicles?.length) {
      const parsedSummary = buildSummary(parsed, false);
      await sendMessage(
        chatId,
        `${parsedSummary}\n\n🚛 <b>Hangi araç için?</b>`,
        vehicleKeyboard(vehicles, imported.id),
      );
      return;
    }
    // No active vehicles — fall through to normal summary so it still gets saved.
  }

  const summary = buildSummary(parsed, true);
  await sendMessage(chatId, summary, imported ? approveKeyboard(imported.id) : undefined);
}

/** Build the load summary text. Pass `withApprovePrompt=true` for the approve/reject flow. */
function buildSummary(parsed: any, withApprovePrompt: boolean): string {
  if (!parsed) return `📦 Mesaj alındı ama otomatik okunamadı. Uygulamadan elle düzenleyebilirsiniz.`;
  return [
    `📦 <b>Yeni yük algılandı</b>`,
    parsed.load_number ? `Load #: ${escapeHtml(parsed.load_number)}` : null,
    parsed.broker_name ? `Broker: ${escapeHtml(parsed.broker_name)}` : null,
    parsed.pickup_location || parsed.delivery_location
      ? `Güzergah: ${escapeHtml(parsed.pickup_location ?? "?")} → ${escapeHtml(parsed.delivery_location ?? "?")}`
      : null,
    parsed.total_miles ? `Mil: ${escapeHtml(parsed.total_miles)}` : null,
    parsed.gross_rate != null ? `Tutar: ${usd(parsed.gross_rate)}` : null,
    withApprovePrompt ? `` : null,
    withApprovePrompt ? `Onaylıyor musunuz?` : null,
  ]
    .filter((v) => v !== null)
    .join("\n");
}

// ============================================================================
// AI management commands (private + group chats)
// ============================================================================

/** Ignore pending rows older than this when looking for an open command. */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Route a chat text message through AI intent detection. Works in both private
 * and group chats. Returns true when fully handled; false to fall through to the
 * load pipeline. In groups an `unknown` message is treated as a load (returns
 * false) so broker confirmations still import; in private it shows help.
 */
async function handleChatIntent(
  supabase: any,
  group: any,
  chatId: string,
  text: string,
  isPrivate: boolean,
): Promise<boolean> {
  const orgId = group.organization_id;

  // 1. An open multi-step command waiting for the user's answer?
  const pending = await getOpenPending(supabase, orgId, chatId);
  if (pending?.awaiting) {
    return continuePending(supabase, pending, chatId, text);
  }

  // 2. Detect intent.
  const result = await detectIntent(text);
  if (!result) return false; // AI backend unavailable -> let load pipeline try.

  if (result.intent === "add_load") return false; // delegate to existing flow.

  if (result.intent === "unknown") {
    if (!isPrivate) return false; // group: treat as a load (preserve import).
    await sendMessage(chatId, helpText());
    return true;
  }

  if (result.intent.startsWith("list_")) {
    await sendList(supabase, orgId, chatId, result.intent, result.data);
    return true;
  }

  if (result.intent === "create_settlement" && result.missing.length === 0) {
    await startSettlement(supabase, orgId, chatId, result.data);
    return true;
  }

  // add/update/delete (and settlement missing its vehicle): collect or confirm.
  if (result.missing.length > 0) {
    const id = await savePending(
      supabase, orgId, chatId, result.intent,
      { data: result.data }, 1, result.missing[0],
    );
    await sendMessage(chatId, askField(result.intent, result.missing[0]));
    return Boolean(id);
  }

  const id = await savePending(
    supabase, orgId, chatId, result.intent, { data: result.data }, 0, null,
  );
  await sendMessage(chatId, summarize(result.intent, result.data), confirmKeyboard(id));
  return true;
}

/** Handle a free-text reply that fills the field an open command was awaiting. */
async function continuePending(
  supabase: any,
  pending: any,
  chatId: string,
  text: string,
): Promise<boolean> {
  if (/^(iptal|vazgeç|vazgec|cancel)$/i.test(text.trim())) {
    await deletePending(supabase, pending.id);
    await sendMessage(chatId, "❌ İptal edildi.");
    return true;
  }

  const data = { ...((pending.payload?.data as Record<string, unknown>) ?? {}) };
  data[pending.awaiting] = text.trim();
  const missing = computeMissing(pending.intent as BotIntent, data);

  if (missing.length > 0) {
    await updatePending(supabase, pending.id, { payload: { data }, awaiting: missing[0], step: 1 });
    await sendMessage(chatId, askField(pending.intent as BotIntent, missing[0]));
    return true;
  }

  if (pending.intent === "create_settlement") {
    const prep = await prepareSettlement(supabase, pending.organization_id, data);
    if (!prep.ok || !prep.payload) {
      await deletePending(supabase, pending.id);
      await sendMessage(chatId, prep.message);
      return true;
    }
    await updatePending(supabase, pending.id, { payload: prep.payload, awaiting: null, step: 0 });
    await sendMessage(chatId, prep.message, confirmKeyboard(pending.id));
    return true;
  }

  await updatePending(supabase, pending.id, { payload: { data }, awaiting: null, step: 0 });
  await sendMessage(chatId, summarize(pending.intent as BotIntent, data), confirmKeyboard(pending.id));
  return true;
}

/** Build a settlement preview, store the RPC payload, and ask for confirmation. */
async function startSettlement(
  supabase: any,
  orgId: string,
  chatId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const prep = await prepareSettlement(supabase, orgId, data);
  if (!prep.ok || !prep.payload) {
    await sendMessage(chatId, prep.message);
    return;
  }
  const id = await savePending(supabase, orgId, chatId, "create_settlement", prep.payload, 0, null);
  await sendMessage(chatId, prep.message, confirmKeyboard(id));
}

// ---------- pending_commands persistence ----------
async function getOpenPending(supabase: any, orgId: string, chatId: string) {
  const cutoff = new Date(Date.now() - PENDING_TTL_MS).toISOString();
  const { data } = await supabase
    .from("bot_pending_commands")
    .select("*")
    .eq("organization_id", orgId)
    .eq("chat_id", chatId)
    .gt("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

/** Replace any prior pending for this chat with a fresh one; returns its id. */
async function savePending(
  supabase: any,
  orgId: string,
  chatId: string,
  intent: string,
  payload: Record<string, unknown>,
  step: number,
  awaiting: string | null,
): Promise<string> {
  await supabase
    .from("bot_pending_commands")
    .delete()
    .eq("organization_id", orgId)
    .eq("chat_id", chatId);
  const { data } = await supabase
    .from("bot_pending_commands")
    .insert({ organization_id: orgId, chat_id: chatId, intent, payload, step, awaiting })
    .select("id")
    .single();
  return data?.id ?? "";
}

async function updatePending(
  supabase: any,
  id: string,
  fields: { payload?: Record<string, unknown>; awaiting?: string | null; step?: number },
) {
  await supabase.from("bot_pending_commands").update(fields).eq("id", id);
}

async function deletePending(supabase: any, id: string) {
  await supabase.from("bot_pending_commands").delete().eq("id", id);
}

// ---------- prompts / summaries / lists ----------
const FIELD_LABELS: Record<string, string> = {
  full_name: "isim",
  type: "kişi tipi (company_driver / owner_operator / investor)",
  unit_number: "araç unit numarası",
  vehicle_type: "araç tipi (truck / box_truck / hotshot / trailer / other)",
  category: "gider kategorisi (örn. fuel, def, tolls)",
  amount: "tutar (USD)",
  mileage: "kilometre",
  name: "kaydın adı / numarası",
  entity_type: "tür (person / vehicle / load)",
  vehicle_unit: "araç unit numarası",
};

function askField(_intent: BotIntent, field: string): string {
  return `❓ Lütfen ${FIELD_LABELS[field] ?? field} belirtin (iptal için "iptal" yazın):`;
}

function summarize(intent: BotIntent, data: Record<string, unknown>): string {
  const v = (k: string) => (data[k] == null ? null : escapeHtml(String(data[k])));
  const lines: (string | null)[] = [];
  switch (intent) {
    case "add_person":
      lines.push(`👤 <b>Kişi ekle</b>`, `İsim: ${v("full_name")}`, `Tip: ${v("type")}`,
        data.phone ? `Telefon: ${v("phone")}` : null, data.email ? `E-posta: ${v("email")}` : null);
      break;
    case "add_vehicle":
      lines.push(`🚛 <b>Araç ekle</b>`, `Unit: ${v("unit_number")}`, `Tip: ${v("vehicle_type")}`,
        data.ownership_type ? `Sahiplik: ${v("ownership_type")}` : null);
      break;
    case "add_expense":
      lines.push(`💸 <b>Gider ekle</b>`, `Kategori: ${v("category")}`, `Tutar: ${v("amount")}`,
        data.vehicle_unit ? `Araç: ${v("vehicle_unit")}` : null);
      break;
    case "update_vehicle_mileage":
      lines.push(`🛣️ <b>Kilometre güncelle</b>`, `Unit: ${v("unit_number")}`, `Km: ${v("mileage")}`);
      break;
    case "update_person":
      lines.push(`✏️ <b>Kişi güncelle</b>`, `İsim: ${v("name")}`);
      break;
    case "delete_entity":
      lines.push(`🗑️ <b>Sil</b>`, `Tür: ${v("entity_type")}`, `Ad: ${v("name")}`);
      break;
    default:
      lines.push(`<b>${escapeHtml(intent)}</b>`);
  }
  lines.push(``, `Onaylıyor musunuz?`);
  return lines.filter((l) => l !== null).join("\n");
}

const LIST_MAX = 10;

async function sendList(
  supabase: any,
  orgId: string,
  chatId: string,
  intent: BotIntent,
  data: Record<string, unknown>,
): Promise<void> {
  const filter = typeof data.filter === "string" ? data.filter.trim() : "";
  const e = (v: unknown) => escapeHtml(v ?? "—");

  let title = "";
  let q: any = null;
  let format: (r: any) => string = () => "";

  switch (intent) {
    case "list_people":
      title = "👤 Kişiler";
      q = supabase.from("people").select("*").eq("organization_id", orgId).order("full_name");
      if (filter) q = q.ilike("full_name", `%${filter}%`);
      format = (r) => `• <b>${e(r.full_name)}</b> — ${e(r.type)} | ${e(r.status)}`;
      break;
    case "list_vehicles":
      title = "🚛 Araçlar";
      q = supabase.from("vehicles").select("*").eq("organization_id", orgId).order("unit_number");
      if (filter) q = q.ilike("unit_number", `%${filter}%`);
      format = (r) => `• <b>${e(r.unit_number)}</b> — ${e(r.vehicle_type)} | ${e(r.status)}`;
      break;
    case "list_loads":
      title = "📦 Yükler";
      q = supabase.from("loads").select("*").eq("organization_id", orgId)
        .order("delivery_date", { ascending: false });
      if (filter) q = q.ilike("load_number", `%${filter}%`);
      format = (r) => `• <b>${e(r.load_number ?? "—")}</b> — ${e(r.route ?? "—")} | ${usd(Number(r.gross_amount) || 0)} | ${e(r.status)}`;
      break;
    case "list_expenses":
      title = "💸 Giderler";
      q = supabase.from("expenses").select("*").eq("organization_id", orgId)
        .order("date", { ascending: false });
      if (filter) q = q.ilike("category", `%${filter}%`);
      format = (r) => `• ${e(r.date)} — ${e(r.category)} ${usd(Number(r.amount) || 0)}`;
      break;
    case "list_settlements":
      title = "🧾 Settlement'lar";
      q = supabase.from("settlements").select("*").eq("organization_id", orgId)
        .order("week_end", { ascending: false });
      format = (r) => `• ${e(r.week_start)}→${e(r.week_end)} — ${e(r.settlement_type)} | ${usd(Number(r.net_pay) || 0)} | ${e(r.status)}`;
      break;
    default:
      await sendMessage(chatId, helpText());
      return;
  }

  const { data: rows } = await q.limit(LIST_MAX + 1);
  const list: any[] = rows ?? [];
  if (list.length === 0) {
    await sendMessage(chatId, `${title}\n\nKayıt bulunamadı.`);
    return;
  }
  const shown = list.slice(0, LIST_MAX).map(format).join("\n");
  const more = list.length > LIST_MAX ? `\n\n… daha fazlası için uygulamayı kullanın.` : "";
  await sendMessage(chatId, `<b>${title}</b>\n\n${shown}${more}`);
}

function helpText(): string {
  return [
    `🤖 <b>Ne yapabilirim?</b>`,
    `Doğal dille yazın, örnekler:`,
    `• "John Doe diye %33 company driver ekle"`,
    `• "Unit 101 truck araç ekle"`,
    `• "Unit 101 fuel 320 dolar gider ekle"`,
    `• "Unit 101 kilometre 152000"`,
    `• "sürücüleri listele" / "araçları listele"`,
    `• "Unit 101 için bu hafta settlement oluştur"`,
    `• "John Doe'yu sil"`,
  ].join("\n");
}

async function handleCallback(supabase: any, cb: any) {
  const parts = String(cb.data || "").split(":");
  const action = parts[0];
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;

  // --- Vehicle selection (private chat) ---
  if (action === "select_vehicle") {
    const [, vehicleId, importId] = parts;

    const { data: imp } = await supabase
      .from("imported_loads")
      .select("*")
      .eq("id", importId)
      .maybeSingle();

    if (!imp) {
      await answerCallbackQuery(cb.id, "Kayıt bulunamadı.");
      return;
    }
    if (imp.chat_id && chatId != null && imp.chat_id !== String(chatId)) {
      await answerCallbackQuery(cb.id, "Yetkisiz.");
      return;
    }
    if (imp.status !== "pending") {
      await answerCallbackQuery(cb.id, `Zaten ${imp.status}.`);
      return;
    }

    // Look up default driver for the selected vehicle.
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("assigned_driver_id")
      .eq("id", vehicleId)
      .maybeSingle();

    // Patch the imported_load with the chosen vehicle + driver, then show approve keyboard.
    await supabase
      .from("imported_loads")
      .update({
        // Store chosen vehicle/driver in extracted jsonb for reference by approve step.
        extracted: { ...(imp.extracted ?? {}), selected_vehicle_id: vehicleId, selected_driver_id: vehicle?.assigned_driver_id ?? null },
      })
      .eq("id", importId);

    const summary = buildSummary(imp.extracted ?? null, true);
    if (messageId) {
      await editMessageText(chatId, messageId, `${summary}\n\n🚛 Araç seçildi. Onaylıyor musunuz?`);
    }
    // Edit message to show approve/reject keyboard now that vehicle is chosen.
    await supabase
      .from("imported_loads")
      .update({ extracted: { ...(imp.extracted ?? {}), selected_vehicle_id: vehicleId, selected_driver_id: vehicle?.assigned_driver_id ?? null } })
      .eq("id", importId);

    // Re-fetch and send approve keyboard by editing the message.
    await answerCallbackQuery(cb.id, `Araç seçildi.`);
    if (chatId && messageId) {
      // Replace vehicle selection keyboard with approve/reject keyboard.
      await editMessageReplyMarkup(chatId, messageId, approveKeyboard(importId));
    }
    return;
  }

  // --- AI command confirm / cancel ---
  if (action === "confirm_cmd" || action === "cancel_cmd") {
    await handleCommandCallback(supabase, cb, action, parts[1], chatId, messageId);
    return;
  }

  // --- Approve / Reject ---
  const importId = parts[1];

  const { data: imp } = await supabase
    .from("imported_loads")
    .select("*")
    .eq("id", importId)
    .maybeSingle();

  if (!imp) {
    await answerCallbackQuery(cb.id, "Kayıt bulunamadı.");
    return;
  }
  // Tenant guard: the callback must come from the same chat the import belongs to.
  // Prevents one chat from approving/rejecting another org's imported load.
  if (imp.chat_id && chatId != null && imp.chat_id !== String(chatId)) {
    await answerCallbackQuery(cb.id, "Yetkisiz.");
    return;
  }
  if (imp.status !== "pending") {
    await answerCallbackQuery(cb.id, `Zaten ${imp.status}.`);
    return;
  }

  if (action === "reject") {
    await supabase.from("imported_loads").update({ status: "rejected" }).eq("id", importId);
    await answerCallbackQuery(cb.id, "Reddedildi.");
    if (chatId && messageId) await editMessageText(chatId, messageId, "❌ Yük reddedildi.");
    return;
  }

  // approve -> create load
  // Resolve vehicle/driver: prefer vehicle selected via private chat, then group defaults.
  const selectedVehicleId = imp.extracted?.selected_vehicle_id ?? null;
  const selectedDriverId = imp.extracted?.selected_driver_id ?? null;

  const { data: group } = await supabase
    .from("telegram_groups")
    .select("*")
    .eq("id", imp.telegram_group_id)
    .maybeSingle();

  const vehicleId = selectedVehicleId ?? group?.vehicle_id ?? null;
  const driverId = selectedDriverId ?? group?.driver_id ?? null;

  const { data: load, error: loadError } = await supabase
    .from("loads")
    .insert({
      organization_id: imp.organization_id,
      load_number: imp.load_number,
      load_source: "broker",
      company_id: group?.company_id ?? null,
      vehicle_id: vehicleId,
      driver_id: driverId,
      pickup_date: imp.pickup_date,
      delivery_date: imp.delivery_date,
      pickup_location: imp.pickup_location,
      delivery_location: imp.delivery_location,
      route:
        imp.pickup_location || imp.delivery_location
          ? `${imp.pickup_location ?? "?"} -> ${imp.delivery_location ?? "?"}`
          : null,
      gross_amount: imp.gross_rate ?? 0,
      total_miles: imp.total_miles ?? 0,
      status: "booked",
      source_file_url: imp.file_url,
      notes: imp.raw_text,
    })
    .select("id")
    .single();

  if (loadError || !load) {
    console.error("telegram webhook: load insert failed", loadError);
    await answerCallbackQuery(cb.id, "Hata: load kaydedilemedi. Lütfen tekrar deneyin.");
    if (chatId && messageId)
      await editMessageText(chatId, messageId, "⚠️ Yük kaydedilemedi, lütfen uygulamadan manuel ekleyin.");
    return;
  }

  await supabase
    .from("imported_loads")
    .update({ status: "approved", created_load_id: load.id })
    .eq("id", importId);

  // Geocode pickup/delivery addresses and activate tracking.
  // Awaited so the work isn't killed when a serverless response returns;
  // the function has internal try/catch and never throws.
  await geocodeAndActivateTracking(supabase, load.id, imp.organization_id);

  await answerCallbackQuery(cb.id, "Onaylandı, load oluşturuldu.");
  if (chatId && messageId)
    await editMessageText(chatId, messageId, "✅ Yük onaylandı ve kaydedildi.");
}

/** Confirm / cancel an AI management command stored in bot_pending_commands. */
async function handleCommandCallback(
  supabase: any,
  cb: any,
  action: string,
  commandId: string,
  chatId: any,
  messageId: any,
) {
  const { data: pending } = await supabase
    .from("bot_pending_commands")
    .select("*")
    .eq("id", commandId)
    .maybeSingle();

  if (!pending) {
    await answerCallbackQuery(cb.id, "Komut bulunamadı veya süresi doldu.");
    if (chatId && messageId) await editMessageText(chatId, messageId, "⌛ Bu komut artık geçerli değil.");
    return;
  }
  // Tenant guard: the callback must come from the chat that created the command.
  if (chatId != null && pending.chat_id !== String(chatId)) {
    await answerCallbackQuery(cb.id, "Yetkisiz.");
    return;
  }

  if (action === "cancel_cmd") {
    await supabase.from("bot_pending_commands").delete().eq("id", commandId);
    await answerCallbackQuery(cb.id, "İptal edildi.");
    if (chatId && messageId) await editMessageText(chatId, messageId, "❌ İptal edildi.");
    return;
  }

  // confirm_cmd
  const result = await executeCommand(supabase, pending as PendingCommand);
  await supabase.from("bot_pending_commands").delete().eq("id", commandId);
  await answerCallbackQuery(cb.id, result.ok ? "Tamam." : "Hata.");
  if (chatId && messageId) await editMessageText(chatId, messageId, result.message);
}

import { createServiceClient } from "@/lib/supabase/server";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  approveKeyboard,
  downloadFile,
  escapeHtml,
} from "@/lib/telegram";
import { parseLoad } from "@/lib/parse";
import { usd } from "@/lib/format";
import { safeEqual, secretMisconfigured } from "@/lib/secure";

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

async function handleMessage(supabase: any, message: any) {
  const chatId = String(message.chat.id);

  const { data: group } = await supabase
    .from("telegram_groups")
    .select("*")
    .eq("chat_id", chatId)
    .maybeSingle();

  if (!group || !group.active) {
    await sendMessage(
      chatId,
      `Bu grup henüz bir araç/şoför ile eşlenmemiş. Chat ID: <code>${escapeHtml(chatId)}</code> — uygulamadan Settings → Telegram ile eşleyin.`,
    );
    return;
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
  const text: string | undefined = message.caption || message.text || undefined;

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

  const summary = parsed
    ? [
        `📦 <b>Yeni yük algılandı</b>`,
        parsed.load_number ? `Load #: ${escapeHtml(parsed.load_number)}` : null,
        parsed.broker_name ? `Broker: ${escapeHtml(parsed.broker_name)}` : null,
        parsed.pickup_location || parsed.delivery_location
          ? `Güzergah: ${escapeHtml(parsed.pickup_location ?? "?")} → ${escapeHtml(parsed.delivery_location ?? "?")}`
          : null,
        parsed.total_miles ? `Mil: ${escapeHtml(parsed.total_miles)}` : null,
        parsed.gross_rate != null ? `Tutar: ${usd(parsed.gross_rate)}` : null,
        ``,
        `Onaylıyor musunuz?`,
      ]
        .filter(Boolean)
        .join("\n")
    : `📦 Mesaj alındı ama otomatik okunamadı. Uygulamadan elle düzenleyebilirsiniz.`;

  await sendMessage(chatId, summary, imported ? approveKeyboard(imported.id) : undefined);
}

async function handleCallback(supabase: any, cb: any) {
  const [action, importId] = String(cb.data || "").split(":");
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;

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
  const { data: group } = await supabase
    .from("telegram_groups")
    .select("*")
    .eq("id", imp.telegram_group_id)
    .maybeSingle();

  const { data: load, error: loadError } = await supabase
    .from("loads")
    .insert({
      organization_id: imp.organization_id,
      load_number: imp.load_number,
      load_source: "broker",
      company_id: group?.company_id ?? null,
      vehicle_id: group?.vehicle_id ?? null,
      driver_id: group?.driver_id ?? null,
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

  await answerCallbackQuery(cb.id, "Onaylandı, load oluşturuldu.");
  if (chatId && messageId)
    await editMessageText(chatId, messageId, "✅ Yük onaylandı ve kaydedildi.");
}

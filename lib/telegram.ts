const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const API = `https://api.telegram.org/bot${TOKEN}`;

/** Max bytes we accept for a downloaded Telegram file (defense against memory abuse). */
const MAX_FILE_BYTES = 20 * 1024 * 1024; // Telegram bot getFile limit

/**
 * Escape user/AI-derived values before interpolating them into a `parse_mode: "HTML"`
 * message. Without this, a `<`/`>`/`&` in extracted fields breaks message delivery or
 * injects unintended markup. Apply to dynamic values only — not to our own tags.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function call<T = Record<string, unknown>>(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null) as { ok?: boolean; result?: T; description?: string } | null;
  if (!res.ok || payload?.ok === false || !payload) {
    throw new Error(payload?.description || `Telegram ${method} failed with HTTP ${res.status}`);
  }
  return payload;
}

export function sendMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: unknown,
) {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  });
}

export function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
) {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
  });
}

export function answerCallbackQuery(id: string, text?: string) {
  return call("answerCallbackQuery", { callback_query_id: id, text });
}

let cachedUsername: string | null | undefined;
/**
 * The bot's @username (without @), via getMe — cached for the process lifetime.
 * Used to build `https://t.me/<username>?start=<code>` deep links. Returns null
 * if the token is unset or Telegram doesn't return a username.
 */
export async function getBotUsername(): Promise<string | null> {
  if (cachedUsername !== undefined) return cachedUsername;
  try {
    const info = await call<{ username?: string }>("getMe", {});
    cachedUsername = info?.result?.username ?? null;
  } catch {
    cachedUsername = null;
  }
  return cachedUsername ?? null;
}

export function editMessageReplyMarkup(
  chatId: string | number,
  messageId: number,
  replyMarkup: unknown,
) {
  return call("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

export function approveKeyboard(importId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Onayla", callback_data: `approve:${importId}` },
        { text: "❌ Reddet", callback_data: `reject:${importId}` },
      ],
    ],
  };
}

/**
 * Confirm/cancel keyboard for an AI-detected management command pending in
 * `bot_pending_commands`. Encodes `confirm_cmd:{id}` / `cancel_cmd:{id}`.
 */
export function confirmKeyboard(commandId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Onayla", callback_data: `confirm_cmd:${commandId}` },
        { text: "❌ İptal", callback_data: `cancel_cmd:${commandId}` },
      ],
    ],
  };
}

/**
 * Inline keyboard asking the user to pick a vehicle for a private-chat import.
 * Each button encodes `select_vehicle:{vehicleId}:{importId}` in callback_data.
 * Buttons are laid out 2 per row.
 */
export function vehicleKeyboard(
  vehicles: Array<{ id: string; unit_number: string }>,
  importId: string,
) {
  const buttons = vehicles.map((v) => ({
    text: v.unit_number,
    callback_data: `select_vehicle:${v.id}:${importId}`,
  }));
  // Group into rows of 2
  const rows: (typeof buttons)[] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return { inline_keyboard: rows };
}

/** Download a Telegram file by file_id; returns bytes + mime. */
export async function downloadFile(
  fileId: string,
): Promise<{ bytes: Buffer; mime: string; ext: string } | null> {
  const info = await call<{ file_path?: string }>("getFile", { file_id: fileId });
  const filePath: string | undefined = info?.result?.file_path;
  if (!filePath) return null;
  const url = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
  const res = await fetch(url);
  // Reject oversized files up-front via the declared length when available.
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_FILE_BYTES) return null;
  const arrayBuf = await res.arrayBuffer();
  if (arrayBuf.byteLength > MAX_FILE_BYTES) return null;
  const ext = filePath.split(".").pop()?.toLowerCase() || "bin";
  const mime =
    ext === "pdf"
      ? "application/pdf"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/jpeg";
  return { bytes: Buffer.from(arrayBuf), mime, ext };
}

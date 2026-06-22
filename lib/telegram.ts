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

async function call(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
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

/** Download a Telegram file by file_id; returns bytes + mime. */
export async function downloadFile(
  fileId: string,
): Promise<{ bytes: Buffer; mime: string; ext: string } | null> {
  const info = await call("getFile", { file_id: fileId });
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

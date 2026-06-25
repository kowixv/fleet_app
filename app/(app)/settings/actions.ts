"use server";

import { randomInt } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requireWriteRole } from "@/lib/auth";
import { getBotUsername } from "@/lib/telegram";
import { revalidatePath } from "next/cache";

export async function updateSettings(formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const supabase = await createClient();
  const num = (k: string) => {
    const v = formData.get(k);
    return v === null || v === "" ? null : Number(v);
  };

  const patch = {
    organization_id: profile.organization_id,
    default_commission: num("default_commission"),
    pm_due_soon_miles: num("pm_due_soon_miles"),
    repair_warning_amount: num("repair_warning_amount"),
    fuel_warning_pct: num("fuel_warning_pct") != null ? Number(num("fuel_warning_pct")) / 100 : null,
    updated_at: new Date().toISOString(),
  };

  await supabase.from("settings").upsert(patch, { onConflict: "organization_id" });
  revalidatePath("/settings");
}

// Unambiguous alphabet (no 0/O/1/I/L) for codes a user might read aloud / type.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(len = 8): string {
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/**
 * Create a single-use Telegram pairing code for the caller's org and return it
 * with a deep link. The bot consumes it via `/start <code>` (private) or
 * `/pair <code>` (group) to bind that chat to this organization.
 */
export async function createTelegramPairingCode(): Promise<{ code: string; link: string | null }> {
  const profile = await requireWriteRole();
  const supabase = await createClient();

  // Retry a couple of times in the unlikely event of a code collision.
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generateCode();
    const { error } = await supabase
      .from("telegram_pairing_codes")
      .insert({ code, organization_id: profile.organization_id });
    if (!error) break;
    if (attempt === 4) throw new Error("Pairing kodu oluşturulamadı, tekrar deneyin.");
  }

  const username = await getBotUsername();
  const link = username ? `https://t.me/${username}?start=${code}` : null;
  return { code, link };
}

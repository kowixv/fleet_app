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

  const defaultCommission = num("default_commission");
  const dueSoonMiles = num("pm_due_soon_miles");
  const dueSoonDays = num("pm_due_soon_days");
  const repairWarning = num("repair_warning_amount");
  const fuelPct = num("fuel_warning_pct");
  const values = [defaultCommission, dueSoonMiles, dueSoonDays, repairWarning, fuelPct];
  if (values.some((value) => value != null && (!Number.isFinite(value) || value < 0))) {
    throw new Error("Ayar değerleri geçersiz.");
  }
  if (dueSoonMiles == null || !Number.isInteger(dueSoonMiles) || dueSoonMiles < 0) {
    throw new Error("Mileage uyarı eşiği sıfır veya daha büyük tam sayı olmalı.");
  }
  if (dueSoonDays == null || !Number.isInteger(dueSoonDays) || dueSoonDays < 1) {
    throw new Error("Tarih uyarı eşiği pozitif tam sayı olmalı.");
  }
  if (fuelPct != null && fuelPct > 100) throw new Error("Fuel yüzdesi 0-100 arasında olmalı.");

  const patch = {
    organization_id: profile.organization_id,
    default_commission: defaultCommission,
    pm_due_soon_miles: dueSoonMiles,
    pm_due_soon_days: dueSoonDays,
    repair_warning_amount: repairWarning,
    fuel_warning_pct: fuelPct != null ? fuelPct / 100 : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("settings").upsert(patch, { onConflict: "organization_id" });
  if (error) throw new Error(error.message);
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

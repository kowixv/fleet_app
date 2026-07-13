"use server";

import { randomInt } from "crypto";
import { requireWriteRole } from "@/lib/auth";
import { getBotUsername } from "@/lib/telegram";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateSettings(formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const supabase = await createClient();
  const num = (key: string) => {
    const value = formData.get(key);
    return value === null || value === "" ? null : Number(value);
  };

  const defaultCommission = num("default_commission");
  const dueSoonMiles = num("pm_due_soon_miles");
  const dueSoonDays = num("pm_due_soon_days");
  const dueSoonEngineHours = num("pm_due_soon_engine_hours");
  const repairWarning = num("repair_warning_amount");
  const allocationTolerance = num("maintenance_invoice_allocation_tolerance");
  const fuelPct = num("fuel_warning_pct");
  const values = [defaultCommission, dueSoonMiles, dueSoonDays, dueSoonEngineHours, repairWarning, allocationTolerance, fuelPct];
  if (values.some((value) => value != null && (!Number.isFinite(value) || value < 0))) {
    throw new Error("Invalid settings value.");
  }
  if (dueSoonMiles == null || !Number.isInteger(dueSoonMiles) || dueSoonMiles < 0) {
    throw new Error("Mileage warning threshold must be a whole number zero or greater.");
  }
  if (dueSoonDays == null || !Number.isInteger(dueSoonDays) || dueSoonDays < 1) {
    throw new Error("Date warning threshold must be a positive whole number.");
  }
  if (dueSoonEngineHours == null || !Number.isInteger(dueSoonEngineHours) || dueSoonEngineHours < 1) {
    throw new Error("Engine-hour warning threshold must be a positive whole number.");
  }
  if (allocationTolerance != null && allocationTolerance > 1000) {
    throw new Error("Invoice allocation tolerance must be between 0 and 1000.");
  }
  if (fuelPct != null && fuelPct > 100) throw new Error("Fuel percentage must be between 0 and 100.");

  const patch = {
    organization_id: profile.organization_id,
    default_commission: defaultCommission,
    pm_due_soon_miles: dueSoonMiles,
    pm_due_soon_days: dueSoonDays,
    pm_due_soon_engine_hours: dueSoonEngineHours,
    repair_warning_amount: repairWarning,
    maintenance_invoice_allocation_tolerance: allocationTolerance,
    fuel_warning_pct: fuelPct != null ? fuelPct / 100 : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("settings").upsert(patch, { onConflict: "organization_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  revalidatePath("/maintenance/settings");
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/units");
  revalidatePath("/maintenance/costs");
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(len = 8): string {
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export async function createTelegramPairingCode(): Promise<{ code: string; link: string | null }> {
  const profile = await requireWriteRole();
  const supabase = await createClient();

  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generateCode();
    const { error } = await supabase
      .from("telegram_pairing_codes")
      .insert({ code, organization_id: profile.organization_id });
    if (!error) break;
    if (attempt === 4) throw new Error("Pairing code could not be created. Try again.");
  }

  const username = await getBotUsername();
  const link = username ? `https://t.me/${username}?start=${code}` : null;
  return { code, link };
}

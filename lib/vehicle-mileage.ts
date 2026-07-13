export type MileageValidationResult =
  | { ok: true; mileage: number }
  | { ok: false; error: string };

export function validateMileageInput(value: unknown): MileageValidationResult {
  if (value === null || value === undefined) {
    return { ok: false, error: "Mileage bos birakilamaz." };
  }

  if (typeof value === "string" && value.trim() === "") {
    return { ok: false, error: "Mileage bos birakilamaz." };
  }

  if (typeof value === "string" && !/^\d+$/.test(value.trim())) {
    return { ok: false, error: "Mileage sifir veya daha buyuk tam sayi olmali." };
  }

  const mileage = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(mileage) || mileage < 0 || !Number.isInteger(mileage)) {
    return { ok: false, error: "Mileage sifir veya daha buyuk tam sayi olmali." };
  }

  return { ok: true, mileage };
}

export function validateOptionalInitialMileage(value: unknown): MileageValidationResult | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return validateMileageInput(value);
}

export function mileageRpcErrorMessage(message: string): string {
  if (/lower than the current odometer/i.test(message)) {
    return "Mileage mevcut odometreden dusuk olamaz.";
  }
  if (/non-negative whole number/i.test(message)) {
    return "Mileage sifir veya daha buyuk tam sayi olmali.";
  }
  if (/vehicle not found/i.test(message)) {
    return "Arac bulunamadi.";
  }
  if (/write permission/i.test(message)) {
    return "Bu islem icin yazma yetkisi gerekli.";
  }
  return message;
}

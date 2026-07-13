import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { loadEnvFile, stdin as input, stdout as output } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  loadEnvFile(".env.local");
} catch {
  // Running without a local env file is fine; required variables are checked below.
}

type AdminClient = SupabaseClient<any, "public", any, any, any>;
import { computePM, comparePMAlerts, formatPMRemaining } from "../lib/maintenance";
import {
  buildMaintenanceImportRecord,
  maintenanceInvoiceHash,
  normalizeMaintenanceInvoiceServices,
  parseMaintenanceInvoice,
  type MaintenanceImportMode,
  type NormalizedMaintenanceService,
} from "../lib/maintenance-invoice";

interface Organization { id: string; name: string; created_at: string }
interface OrganizationProfile { organization_id: string; email: string | null }
interface OrganizationVehicle { organization_id: string; unit_number: string }
interface Vehicle { id: string; unit_number: string; current_mileage: number | null }
interface ExistingRule { id: string; service_type: string }

const rl = createInterface({ input, output });

function todayInFleetTimezone(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.FLEET_TIMEZONE ?? "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

function parseNextDue(answer: string, service: Pick<NormalizedMaintenanceService, "performed_date" | "mileage">) {
  const normalized = answer.trim().toLowerCase().replace(/,/g, "");
  const mileage = normalized.match(/^(\d+)\s*(mi|mil|mile|miles)?$/);
  if (mileage) {
    const value = Number(mileage[1]);
    if (service.mileage != null && value <= service.mileage) {
      throw new Error("Sonraki mileage, işlem mileage değerinden büyük olmalı.");
    }
    return { next_due_mileage: value, next_due_date: null };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    if (service.performed_date && normalized <= service.performed_date) {
      throw new Error("Sonraki tarih, işlem tarihinden sonra olmalı.");
    }
    return { next_due_mileage: null, next_due_date: normalized };
  }

  const period = normalized.match(/^(\d+)\s*(gün|gun|day|days|hafta|week|weeks|ay|month|months|yıl|yil|year|years)$/);
  if (!period) throw new Error("Örnek: 155000 mil, 90 gün, 3 ay veya 2026-10-12");
  const amount = Number(period[1]);
  const baseDate = service.performed_date ?? todayInFleetTimezone();
  const unit = period[2];
  if (["gün", "gun", "day", "days"].includes(unit)) {
    return { next_due_mileage: null, next_due_date: addDays(baseDate, amount) };
  }
  if (["hafta", "week", "weeks"].includes(unit)) {
    return { next_due_mileage: null, next_due_date: addDays(baseDate, amount * 7) };
  }
  if (["ay", "month", "months"].includes(unit)) {
    return { next_due_mileage: null, next_due_date: addMonths(baseDate, amount) };
  }
  return { next_due_mileage: null, next_due_date: addMonths(baseDate, amount * 12) };
}

function answerYes(value: string, defaultYes = true): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return defaultYes;
  return normalized === "e" || normalized === "evet" || normalized === "y" || normalized === "yes";
}

function printNormalizedServices(services: NormalizedMaintenanceService[]) {
  console.log(`\n${services.length} normalize edilmiÅŸ servis bulundu:`);
  services.forEach((service, index) => {
    const parts = service.parts_used.length ? ` | ParÃ§alar: ${service.parts_used.join(", ")}` : "";
    const cost = service.cost == null ? "" : ` | Maliyet: $${Number(service.cost).toFixed(2)}`;
    console.log(`${index + 1}. ${service.service_type}${parts}${cost} | VarsayÄ±lan: ${service.default_action === "history" ? "geÃ§miÅŸ" : "plan"}`);
  });
}

async function chooseSaveMode(service: NormalizedMaintenanceService): Promise<MaintenanceImportMode> {
  while (true) {
    const suffix = service.default_action === "history" ? " [geÃ§miÅŸ]" : " [plan]";
    const answer = (await rl.question("NasÄ±l kaydedilsin? [plan/geÃ§miÅŸ/atla]" + suffix + ": "))
      .trim()
      .toLowerCase();
    if (!answer) return service.default_action;
    if (["plan", "p"].includes(answer)) return "plan";
    if (["geÃ§miÅŸ", "gecmis", "geçmiş", "history", "h", "g"].includes(answer)) return "history";
    if (["atla", "skip", "s", "a"].includes(answer)) return "skip";
    console.log("GeÃ§ersiz seÃ§im. plan, geÃ§miÅŸ veya atla yazÄ±n.");
  }
}

async function chooseOrganization(supabase: AdminClient): Promise<Organization> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, created_at")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  const organizations = (data ?? []) as Organization[];
  if (organizations.length === 0) throw new Error("Organization bulunamadı.");
  if (organizations.length === 1) return organizations[0];

  const organizationIds = organizations.map((org) => org.id);
  const [{ data: profiles, error: profilesError }, { data: vehicles, error: vehiclesError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("organization_id, email")
      .in("organization_id", organizationIds)
      .order("email", { ascending: true }),
    supabase
      .from("vehicles")
      .select("organization_id, unit_number")
      .in("organization_id", organizationIds)
      .order("unit_number", { ascending: true }),
  ]);
  if (profilesError) throw profilesError;
  if (vehiclesError) throw vehiclesError;

  const emailsByOrg = new Map<string, string[]>();
  for (const profile of (profiles ?? []) as OrganizationProfile[]) {
    const email = profile.email?.trim();
    if (!email) continue;
    const emails = emailsByOrg.get(profile.organization_id) ?? [];
    if (!emails.includes(email)) emails.push(email);
    emailsByOrg.set(profile.organization_id, emails);
  }

  const unitsByOrg = new Map<string, string[]>();
  for (const vehicle of (vehicles ?? []) as OrganizationVehicle[]) {
    const unit = vehicle.unit_number.trim();
    if (!unit) continue;
    const units = unitsByOrg.get(vehicle.organization_id) ?? [];
    units.push(unit);
    unitsByOrg.set(vehicle.organization_id, units);
  }

  console.log("\nOrganization seç:");
  organizations.forEach((org, index) => {
    const emails = emailsByOrg.get(org.id) ?? [];
    const units = unitsByOrg.get(org.id) ?? [];
    const shownUnits = units.slice(0, 8);
    const extraUnits = units.length > shownUnits.length ? ` +${units.length - shownUnits.length} more` : "";
    console.log(
      [
        `${index + 1}. ${org.name}`,
        `id=${org.id.slice(0, 8)}`,
        `emails=${emails.length ? emails.join(", ") : "—"}`,
        `vehicles=${units.length}`,
        `units=${shownUnits.length ? shownUnits.join(", ") : "—"}${extraUnits}`,
      ].join(" | "),
    );
  });
  const selected = Number(await rl.question("Numara: ")) - 1;
  if (!organizations[selected]) throw new Error("Geçersiz seçim.");
  return organizations[selected];
}

async function chooseVehicle(vehicles: Vehicle[], detectedUnit: string | null): Promise<Vehicle> {
  const detected = detectedUnit?.trim().toLowerCase();
  const exact = detected
    ? vehicles.find((vehicle) => vehicle.unit_number.trim().toLowerCase() === detected)
    : undefined;
  if (exact) {
    const answer = (await rl.question(`Unit ${exact.unit_number} bulundu. Kullanılsın mı? [E/h]: `)).trim().toLowerCase();
    if (!answer || answer === "e" || answer === "y") return exact;
  }

  console.log("\nAraç seç:");
  vehicles.forEach((vehicle, index) =>
    console.log(`${index + 1}. Unit ${vehicle.unit_number} — ${Number(vehicle.current_mileage ?? 0).toLocaleString("en-US")} mi`),
  );
  const selected = Number(await rl.question("Numara: ")) - 1;
  if (!vehicles[selected]) throw new Error("Geçersiz araç seçimi.");
  return vehicles[selected];
}

async function printAlerts(supabase: AdminClient, organizationId: string) {
  const [{ data: rules, error: rulesError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase
      .from("maintenance_rules")
      .select("*, vehicles!maintenance_rules_vehicle_id_fkey(unit_number, current_mileage)")
      .eq("organization_id", organizationId)
      .eq("active", true),
    supabase
      .from("settings")
      .select("pm_due_soon_miles, pm_due_soon_days")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);
  if (rulesError) throw rulesError;
  if (settingsError) throw settingsError;

  const settingsRow = settings as { pm_due_soon_miles?: number | null; pm_due_soon_days?: number | null } | null;
  const thresholds = {
    dueSoonMiles: Number(settingsRow?.pm_due_soon_miles ?? 2_000),
    dueSoonDays: Number(settingsRow?.pm_due_soon_days ?? 7),
  };
  const alerts = (rules ?? [])
    .map((rule: any) => ({
      rule,
      pm: computePM(rule, Number(rule.vehicles?.current_mileage ?? 0), thresholds, todayInFleetTimezone()),
    }))
    .filter(({ pm }) => pm.status !== "ok")
    .sort((a, b) => comparePMAlerts(a.pm, b.pm));

  console.log("\n=== BAKIM UYARILARI ===");
  if (alerts.length === 0) {
    console.log("Yaklaşan bakım yok.");
    return;
  }
  for (const { rule, pm } of alerts) {
    console.log(`Unit ${rule.vehicles?.unit_number ?? "?"} | ${rule.service_type} | ${pm.label} | ${formatPMRemaining(pm)}`);
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase environment variables are missing in .env.local.");
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const organization = await chooseOrganization(supabase);
  await printAlerts(supabase, organization.id);

  const argumentPath = process.argv.slice(2).join(" ").trim();
  const enteredPath = argumentPath || (await rl.question("\nPDF invoice dosya yolu: ")).trim();
  const filePath = resolve(enteredPath.replace(/^['\"]|['\"]$/g, ""));
  if (!filePath.toLowerCase().endsWith(".pdf")) throw new Error("Yalnızca PDF dosyası kabul edilir.");
  const bytes = new Uint8Array(await readFile(filePath));
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("PDF 20 MB'dan büyük olamaz.");

  const hash = maintenanceInvoiceHash(bytes);
  const { data: duplicate, error: duplicateError } = await supabase
    .from("maintenance_invoices")
    .select("id, file_name, created_at")
    .eq("organization_id", organization.id)
    .eq("file_hash", hash)
    .maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) {
    console.log(`\nDUPLICATE: Bu PDF daha önce kaydedilmiş (${duplicate.file_name}, ${duplicate.created_at}).`);
    return;
  }

  console.log("\nPDF analiz ediliyor...");
  const { parsed, rawText } = await parseMaintenanceInvoice(bytes);
  const { data: vehicleRows, error: vehicleError } = await supabase
    .from("vehicles")
    .select("id, unit_number, current_mileage")
    .eq("organization_id", organization.id)
    .order("unit_number");
  if (vehicleError) throw vehicleError;
  const vehicles = (vehicleRows ?? []) as Vehicle[];
  if (vehicles.length === 0) throw new Error("Önce sisteme araç eklemelisiniz.");
  const vehicle = await chooseVehicle(vehicles, parsed.unit_number ?? parsed.vehicle_id_text);

  const normalizedServices = normalizeMaintenanceInvoiceServices(parsed.services);
  printNormalizedServices(normalizedServices);
  if (!answerYes(await rl.question("\nBu normalize listeyle devam edilsin mi? [E/h]: "))) {
    console.log("İptal edildi. Veritabanına yazılmadı.");
    return;
  }

  const services = [];
  for (const [index, service] of normalizedServices.entries()) {
    const performedDate = service.performed_date ?? parsed.invoice_date ?? todayInFleetTimezone();
    const mileage = service.mileage ?? parsed.mileage ?? vehicle.current_mileage;
    const normalizedService = service.service_type.trim();
    console.log(`\n[${index + 1}/${normalizedServices.length}] ${normalizedService}`);
    if (service.parts_used.length) console.log(`Parçalar: ${service.parts_used.join(", ")}`);
    const saveMode = await chooseSaveMode(service);
    if (saveMode === "skip") {
      console.log("Atlandı.");
      continue;
    }

    let nextDue = { next_due_mileage: null as number | null, next_due_date: null as string | null };
    if (saveMode === "plan") {
      const { data: existingRule, error: ruleError } = await supabase
        .from("maintenance_rules")
        .select("id, service_type")
        .eq("organization_id", organization.id)
        .eq("vehicle_id", vehicle.id)
        .eq("active", true)
        .ilike("service_type", normalizedService)
        .maybeSingle();
      if (ruleError) throw ruleError;
      console.log(existingRule ? "Aktif kural güncellenecek." : "Yeni aktif kural oluşturulacak.");

      while (!nextDue.next_due_mileage && !nextDue.next_due_date) {
        try {
          const answer = await rl.question("Bu işlemin bir sonraki bakım tarihi veya mili nedir? (örn. 155,000 mil veya 3 ay): ");
          nextDue = parseNextDue(answer, { performed_date: performedDate, mileage: mileage == null ? null : Number(mileage) });
        } catch (error) {
          console.log(`Geçersiz cevap: ${(error as Error).message}`);
        }
      }

      if (nextDue.next_due_mileage != null && Number(vehicle.current_mileage ?? 0) === 0) {
        const proceed = await rl.question(
          "UYARI: Bu aracın mevcut mileage değeri 0 görünüyor. Mileage bazlı aktif kural oluşturulsun mu? [e/H]: ",
        );
        if (!answerYes(proceed, false)) {
          console.log("Mileage bazlı plan atlandı; kayıt geçmiş olarak saklanacak.");
          nextDue = { next_due_mileage: null, next_due_date: null };
        }
      }
    }

    const built = buildMaintenanceImportRecord({
      service,
      mode: saveMode,
      vehicleId: vehicle.id,
      vehicleCurrentMileage: vehicle.current_mileage == null ? null : Number(vehicle.current_mileage),
      invoiceMileage: parsed.mileage,
      invoiceShopName: parsed.shop_name,
      performedDate,
      nextDue,
    });
    if (built.record) services.push(built.record);
  }

  if (services.length === 0) {
    console.log("\nKaydedilecek servis kalmadı. Veritabanına yazılmadı.");
    return;
  }
  console.log(`\n${services.length} bakım kaydı hazırlanıyor. Bu adımdan sonra PDF yüklenecek ve RPC çalışacak.`);
  if (!answerYes(await rl.question("Veritabanına kaydedilsin mi? [E/h]: "))) {
    console.log("İptal edildi. Veritabanına yazılmadı.");
    return;
  }

  const storagePath = `${organization.id}/${hash}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("maintenance-invoices")
    .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) throw uploadError;

  const { data: invoiceId, error: saveError } = await supabase.rpc("save_maintenance_invoice", {
    p_invoice: {
      organization_id: organization.id,
      vehicle_id: vehicle.id,
      invoice_number: parsed.invoice_number,
      invoice_date: parsed.invoice_date,
      shop_name: parsed.shop_name,
      file_name: basename(filePath),
      storage_path: storagePath,
      file_hash: hash,
      raw_text: rawText,
      parsed_data: parsed,
    },
    p_services: services,
  });

  if (saveError) {
    await supabase.storage.from("maintenance-invoices").remove([storagePath]);
    if (saveError.message.includes("DUPLICATE_INVOICE")) {
      console.log("DUPLICATE: Bu invoice daha önce kaydedilmiş.");
      return;
    }
    throw saveError;
  }

  console.log(`\nKAYDEDİLDİ: Invoice ${invoiceId}; ${services.length} bakım kaydı oluşturuldu.`);
  await printAlerts(supabase, organization.id);
}

main()
  .catch((error) => {
    console.error(`\nHATA: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());

import { canonicalManualServiceKey } from "@/lib/manual-maintenance";

export type MaintenanceProgramVehicleType = "truck" | "box_truck";
export type MaintenanceProgramSection = "frequent" | "scheduled" | "major";
export type MaintenancePackageLevel = "basic" | "full";
export type MaintenanceProgramInstallMode = "reminder" | "reference";
export type MaintenanceProgramEngineRequirement = "cummins_x15" | "paccar_mx";
export type MaintenanceProgramEquipmentRequirement =
  | "air_brakes"
  | "fifth_wheel"
  | "diesel_aftertreatment"
  | "diesel_fuel_system";

export const MAINTENANCE_PROGRAM_VEHICLE_OPTIONS = [
  { value: "truck", label: "Semi Truck" },
  { value: "box_truck", label: "Box Truck" },
] as const satisfies ReadonlyArray<{ value: MaintenanceProgramVehicleType; label: string }>;

export const MAINTENANCE_INTERVAL_DAYS = {
  oneMonth: 30,
  twoMonths: 60,
  threeMonths: 90,
  fourMonths: 120,
  sixMonths: 180,
  nineMonths: 270,
  tenMonths: 300,
  twelveMonths: 365,
  eighteenMonths: 540,
  thirtyMonths: 900,
  threeYears: 1_095,
  fourYears: 1_460,
  eightYears: 2_920,
} as const;

export interface MaintenanceProgramPreset {
  id: string;
  serviceType: string;
  titleTr: string;
  descriptionTr: string;
  section: MaintenanceProgramSection;
  applicableVehicleTypes: MaintenanceProgramVehicleType[];
  intervalMiles?: number;
  intervalDays?: number;
  intervalEngineHours?: number;
  packageLevel: MaintenancePackageLevel;
  basicVehicleTypes?: MaintenanceProgramVehicleType[];
  defaultEnabled: boolean;
  defaultEnabledByVehicleType?: Partial<Record<MaintenanceProgramVehicleType, boolean>>;
  engineRequirement?: MaintenanceProgramEngineRequirement;
  equipmentRequirement?: MaintenanceProgramEquipmentRequirement;
  installMode: MaintenanceProgramInstallMode;
  warningText?: string;
  warningTextByVehicleType?: Partial<Record<MaintenanceProgramVehicleType, string>>;
  sortOrder: number;
}

export interface MaintenanceProgramReferenceItem {
  id: string;
  titleTr: string;
  descriptionTr: string;
  applicableVehicleTypes: MaintenanceProgramVehicleType[];
  installMode: "reference";
  sortOrder: number;
}

export interface MaintenanceProgramExclusion {
  id: string;
  originalItem: string;
  applicableVehicleTypes: "none" | MaintenanceProgramVehicleType[];
  reason: string;
}

export interface MaintenanceProgramCoverageRow {
  originalItem: string;
  applicability: string;
  disposition: "Reminder" | "Reference" | "Excluded";
  presetId: string;
  interval: string;
  reason: string;
}

export function summarizeMaintenanceProgramStatuses(results: Array<{ status: "created" | "skipped" | "failed" }>) {
  const created = results.filter((result) => result.status === "created").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const failed = results.filter((result) => result.status === "failed").length;
  return { ok: failed === 0, created, skipped, failed };
}

export interface MaintenanceProgramExistingRule {
  id: string;
  vehicle_id: string | null;
  vehicle_type: string | null;
  service_type: string;
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours: number | null;
  active: boolean;
}

const BOTH: MaintenanceProgramVehicleType[] = ["truck", "box_truck"];
const TRUCK: MaintenanceProgramVehicleType[] = ["truck"];
const BOX: MaintenanceProgramVehicleType[] = ["box_truck"];

export const MAINTENANCE_PROGRAM_PRESETS: MaintenanceProgramPreset[] = [
  {
    id: "power-steering-fluid-check",
    serviceType: "Power Steering Fluid Check",
    titleTr: "Power steering sıvısı ve kaçak kontrolü",
    descriptionTr: "Sıvı seviyesi, rezervuar, pompa, hortumlar ve kaçaklar kontrol edilir.",
    section: "frequent", applicableVehicleTypes: BOTH, intervalMiles: 15_000, intervalDays: 30,
    packageLevel: "basic", defaultEnabled: true, installMode: "reminder", sortOrder: 10,
  },
  {
    id: "transmission-fluid-leak-check",
    serviceType: "Transmission Fluid & Leak Check",
    titleTr: "Şanzıman yağ seviyesi ve kaçak kontrolü",
    descriptionTr: "Şanzıman gövdesi, tapalar, keçeler, elektrik bağlantıları ve hava hatları kontrol edilir.",
    section: "frequent", applicableVehicleTypes: BOTH, intervalMiles: 15_000, intervalDays: 30,
    packageLevel: "basic", defaultEnabled: true, installMode: "reminder", sortOrder: 20,
  },
  {
    id: "fifth-wheel-lubrication",
    serviceType: "Fifth Wheel Lubrication",
    titleTr: "Fifth wheel yağlama",
    descriptionTr: "Üst tabla, jaws, release handle, bracket pins ve slider mekanizması yağlanır.",
    section: "frequent", applicableVehicleTypes: TRUCK, intervalMiles: 15_000, intervalDays: 30,
    packageLevel: "basic", defaultEnabled: true, equipmentRequirement: "fifth_wheel", installMode: "reminder", sortOrder: 30,
  },
  {
    id: "electronic-fault-scan",
    serviceType: "Electronic Fault Scan",
    titleTr: "Genel elektronik arıza taraması",
    descriptionTr: "ECM, TCM, ABS, radar, kamera ve aftertreatment arıza kodları taranır.",
    section: "frequent", applicableVehicleTypes: BOTH, intervalMiles: 20_000, intervalDays: 60,
    packageLevel: "basic", defaultEnabled: true, installMode: "reminder", sortOrder: 40,
  },
  {
    id: "brake-inspection",
    serviceType: "Brake Inspection",
    titleTr: "Fren balata ve sistem kontrolü",
    descriptionTr: "Balata kalınlığı ile fren sistemi, hortumlar ve bağlantılar kontrol edilir.",
    section: "frequent", applicableVehicleTypes: BOTH, intervalMiles: 20_000, intervalDays: 60,
    packageLevel: "basic", defaultEnabled: true, installMode: "reminder", sortOrder: 50,
  },
  {
    id: "battery-connections-inspection",
    serviceType: "Battery & Connections Inspection",
    titleTr: "Aküler ve bağlantılar",
    descriptionTr: "Akü kutusu, sabitlemeler, kablolar, şaseler ve korozyon kontrol edilir.",
    section: "frequent", applicableVehicleTypes: BOTH, intervalMiles: 20_000, intervalDays: 60,
    packageLevel: "basic", defaultEnabled: true, installMode: "reminder", sortOrder: 60,
  },
  {
    id: "coolant-hose-inspection",
    serviceType: "Cooling Hose Inspection",
    titleTr: "Coolant hortumları görsel kontrolü",
    descriptionTr: "Şişme, yumuşama, çatlak, sürtünme, kelepçe izi ve kaçak kontrol edilir.",
    section: "frequent", applicableVehicleTypes: BOTH, intervalMiles: 20_000, intervalDays: 60,
    packageLevel: "basic", defaultEnabled: true, installMode: "reminder", sortOrder: 70,
  },
  {
    id: "engine-air-filter-inspection",
    serviceType: "Engine Air Filter",
    titleTr: "Motor hava filtresi kontrolü",
    descriptionTr: "Restriction indicator, filtre gövdesi, dust valve ve emiş boruları kontrol edilir.",
    section: "frequent", applicableVehicleTypes: BOTH, intervalMiles: 20_000, intervalDays: 60,
    packageLevel: "basic", defaultEnabled: true, installMode: "reminder", sortOrder: 80,
  },
  {
    id: "clutch-inspection",
    serviceType: "Clutch Inspection",
    titleTr: "Debriyaj durumu ve clutch-life kontrolü",
    descriptionTr: "Clutch-life verisi, kaydırma, titreme, aşırı ısı, kavrama ve vites kalitesi kontrol edilir.",
    section: "frequent", applicableVehicleTypes: TRUCK, intervalMiles: 20_000, intervalDays: 60,
    packageLevel: "basic", defaultEnabled: true, installMode: "reminder", sortOrder: 90,
  },
  {
    id: "suspension-steering-inspection",
    serviceType: "Suspension & Steering Inspection",
    titleTr: "Süspansiyon ve direksiyon kontrolü",
    descriptionTr: "Amortisörler, burçlar, air bags, torque rods, ride height ve direksiyon bağlantıları kontrol edilir.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalMiles: 30_000, intervalDays: 90,
    packageLevel: "basic", defaultEnabled: true, installMode: "reminder", sortOrder: 100,
  },
  {
    id: "engine-oil-filter",
    serviceType: "Wet PM / Oil Service",
    titleTr: "Motor yağı ve yağ filtresi",
    descriptionTr: "Motor yağı ve yağ filtresi değiştirilir.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalMiles: 37_500, intervalDays: 300,
    packageLevel: "basic", defaultEnabled: true, installMode: "reminder", sortOrder: 110,
    warningTextByVehicleType: { box_truck: "Aracın motor üreticisi bakım aralığına göre doğrulanmalıdır." },
  },
  {
    id: "fuel-filters",
    serviceType: "Fuel Filters",
    titleTr: "Motor yakıt filtreleri",
    descriptionTr: "Birincil ve ikincil yakıt filtreleri değiştirilir.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalMiles: 37_500, intervalDays: 300,
    packageLevel: "basic", defaultEnabled: true, installMode: "reminder", sortOrder: 120,
    warningTextByVehicleType: { box_truck: "Dizel motor ve üretici aralığına göre doğrulanmalıdır." },
  },
  {
    id: "detailed-brake-wheel-end-inspection",
    serviceType: "Detailed Brake & Wheel-End Inspection",
    titleTr: "Fren ve wheel-end detaylı kontrolü",
    descriptionTr: "Balatalar, drums/rotors, calipers, slide pins, hub seals, bearings ve hub oil kontrol edilir.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalMiles: 45_000, intervalDays: 120,
    packageLevel: "basic", defaultEnabled: true, installMode: "reminder", sortOrder: 130,
  },
  {
    id: "coolant-condition-check",
    serviceType: "Coolant Chemistry Test",
    titleTr: "Coolant durumu kontrolü",
    descriptionTr: "Donma koruması, renk, karışım, kirlenme ve yağ karışması kontrol edilir.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalMiles: 30_000, intervalDays: 180,
    packageLevel: "basic", defaultEnabled: true, installMode: "reminder", sortOrder: 140,
  },
  {
    id: "dot-annual",
    serviceType: "DOT Annual",
    titleTr: "DOT yıllık kontrolü",
    descriptionTr: "Yıllık DOT inspection hatırlatıcısı.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalDays: 365,
    packageLevel: "basic", defaultEnabled: true, installMode: "reminder", sortOrder: 150,
  },
  {
    id: "fuel-water-separator-drain",
    serviceType: "Fuel Water Separator Drain",
    titleTr: "Yakıt su ayırıcı boşaltma",
    descriptionTr: "Yakıt su ayırıcı kontrol edilir ve gerektiğinde boşaltılır.",
    section: "frequent", applicableVehicleTypes: BOTH, intervalDays: 7,
    packageLevel: "full", defaultEnabled: true, defaultEnabledByVehicleType: { box_truck: false },
    equipmentRequirement: "diesel_fuel_system", installMode: "reminder", sortOrder: 160,
    warningTextByVehicleType: { box_truck: "Yalnızca dizel motorlu araçlar için seçin." },
  },
  {
    id: "air-tank-drain",
    serviceType: "Air Tank Drain",
    titleTr: "Hava tanklarının boşaltılması",
    descriptionTr: "Hava tanklarında biriken su ve kir boşaltılır.",
    section: "frequent", applicableVehicleTypes: BOTH, intervalDays: 14,
    packageLevel: "full", defaultEnabled: true, defaultEnabledByVehicleType: { box_truck: false },
    equipmentRequirement: "air_brakes", installMode: "reminder", sortOrder: 170,
    warningTextByVehicleType: { box_truck: "Yalnızca air brake bulunan araçlar için seçin." },
  },
  {
    id: "engine-emission-sensor-review",
    serviceType: "Engine and Emission Sensor Review",
    titleTr: "Motor ve emisyon sensörleri kontrolü",
    descriptionTr: "Motor ve emisyon sensörleri arıza, plausibility ve bağlantı açısından incelenir.",
    section: "frequent", applicableVehicleTypes: TRUCK, intervalMiles: 20_000, intervalDays: 60,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 180,
  },
  {
    id: "electrical-harness-connector-inspection",
    serviceType: "Electrical Harness & Connector Inspection",
    titleTr: "Elektrik tesisatı ve sensör soketleri",
    descriptionTr: "Kablo tesisatı, soketler, sürtünme ve korozyon kontrol edilir.",
    section: "frequent", applicableVehicleTypes: BOTH, intervalMiles: 20_000, intervalDays: 60,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 190,
  },
  {
    id: "differential-axle-leak-inspection",
    serviceType: "Differential & Axle Leak Inspection",
    titleTr: "Diferansiyel ve aks yağ seviyesi kontrolü",
    descriptionTr: "Diferansiyel ve aks yağ seviyesi, keçeler ve kaçaklar kontrol edilir.",
    section: "frequent", applicableVehicleTypes: BOTH, intervalMiles: 20_000, intervalDays: 60,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 200,
  },
  {
    id: "oil-pan-engine-leak-inspection",
    serviceType: "Oil Pan / Engine Oil Leak Inspection",
    titleTr: "Karter contası ve motor yağ kaçağı kontrolü",
    descriptionTr: "Karter, conta yüzeyleri ve motor yağ kaçağı izleri kontrol edilir.",
    section: "frequent", applicableVehicleTypes: BOTH, intervalMiles: 20_000, intervalDays: 60,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 210,
  },
  {
    id: "cabin-air-filter-inspection",
    serviceType: "Cabin Air Filter",
    titleTr: "Kabin hava filtresi kontrolü",
    descriptionTr: "Kabin hava filtresi kirlenme ve hava akışı açısından kontrol edilir.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalMiles: 20_000, intervalDays: 180,
    packageLevel: "full", basicVehicleTypes: BOX, defaultEnabled: true, installMode: "reminder", sortOrder: 220,
  },
  {
    id: "fifth-wheel-detailed-inspection",
    serviceType: "Fifth Wheel Detailed Inspection",
    titleTr: "Fifth wheel detaylı kontrolü",
    descriptionTr: "Kilitleme parçaları, boşluk, mounting, slider ve release mekanizması kontrol edilir.",
    section: "scheduled", applicableVehicleTypes: TRUCK, intervalMiles: 30_000, intervalDays: 90,
    packageLevel: "full", defaultEnabled: true, equipmentRequirement: "fifth_wheel", installMode: "reminder", sortOrder: 230,
  },
  {
    id: "engine-belt-tensioner-inspection",
    serviceType: "Engine Belt and Tensioner Inspection",
    titleTr: "Motor kayışları ve tensioner kontrolü",
    descriptionTr: "Kayışlar, tensioner ve idlers aşınma, çatlak ve hizalama açısından kontrol edilir.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalMiles: 37_500,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 240,
  },
  {
    id: "abs-wheel-speed-sensor-inspection",
    serviceType: "ABS Wheel-Speed Sensor Inspection",
    titleTr: "ABS wheel-speed sensörleri",
    descriptionTr: "Sensörler, tone rings, kablolar ve konektörler kontrol edilir.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalMiles: 45_000, intervalDays: 120,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 250,
  },
  {
    id: "u-bolt-suspension-fastener-inspection",
    serviceType: "U-Bolt & Suspension Fastener Inspection",
    titleTr: "U-bolt ve süspansiyon bağlantıları",
    descriptionTr: "U-bolts ve süspansiyon bağlantıları gevşeklik ve hasar açısından kontrol edilir.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalMiles: 45_000, intervalDays: 120,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 260,
  },
  {
    id: "battery-conductance-load-test",
    serviceType: "Battery Test",
    titleTr: "Akü conductance/load testi",
    descriptionTr: "Aküler conductance veya load test ile ölçülür ve bağlantılar doğrulanır.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalDays: 120,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 270,
  },
  {
    id: "cabin-air-filter-replacement",
    serviceType: "Cabin Air Filter Scheduled Replacement",
    titleTr: "Kabin hava filtresi değişimi",
    descriptionTr: "Kabin hava filtresi değiştirilir.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalDays: 180,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 280,
  },
  {
    id: "detailed-cooling-system-inspection",
    serviceType: "Detailed Cooling System Inspection",
    titleTr: "Coolant hortumları detaylı kontrolü",
    descriptionTr: "Hortumlar, clamps, radiator, reservoir ve bağlantılar ayrıntılı kontrol edilir.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalMiles: 90_000, intervalDays: 270,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 290,
  },
  {
    id: "power-steering-fluid-filter-service",
    serviceType: "Power Steering Fluid & Filter Service",
    titleTr: "Power steering sıvısı ve filtresi",
    descriptionTr: "Power steering sıvısı ve varsa sistem filtresi servis edilir.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalMiles: 90_000, intervalDays: 270,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 300,
  },
  {
    id: "air-dryer-cartridge-purge-valve",
    serviceType: "Air Dryer Cartridge",
    titleTr: "Air dryer kartuşu ve purge valve",
    descriptionTr: "Air dryer kartuşu ile purge valve kontrol edilir ve servis edilir.",
    section: "scheduled", applicableVehicleTypes: BOTH, intervalDays: 365,
    packageLevel: "full", defaultEnabled: true, defaultEnabledByVehicleType: { box_truck: false },
    equipmentRequirement: "air_brakes", installMode: "reminder", sortOrder: 310,
    warningTextByVehicleType: { box_truck: "Yalnızca air brake bulunan araçlar için seçin." },
  },
  {
    id: "brake-chamber-inspection",
    serviceType: "Brake Chamber Inspection",
    titleTr: "Brake chamber kontrolü",
    descriptionTr: "Brake chambers kaçak, hasar ve çalışma açısından kontrol edilir.",
    section: "scheduled", applicableVehicleTypes: BOX, intervalMiles: 45_000, intervalDays: 120,
    packageLevel: "full", defaultEnabled: false, equipmentRequirement: "air_brakes", installMode: "reminder", sortOrder: 320,
    warningText: "Yalnızca air brake bulunan araçlar için seçin.",
  },
  {
    id: "slack-adjuster-inspection",
    serviceType: "Slack Adjuster Inspection",
    titleTr: "Slack adjuster kontrolü",
    descriptionTr: "Slack adjusters ayar, hareket ve hasar açısından kontrol edilir.",
    section: "scheduled", applicableVehicleTypes: BOX, intervalMiles: 45_000, intervalDays: 120,
    packageLevel: "full", defaultEnabled: false, equipmentRequirement: "air_brakes", installMode: "reminder", sortOrder: 330,
    warningText: "Yalnızca air brake bulunan araçlar için seçin.",
  },
  {
    id: "cooling-system-laboratory-analysis",
    serviceType: "Cooling System Laboratory Analysis",
    titleTr: "Cooling system laboratuvar analizi",
    descriptionTr: "Coolant numunesi laboratuvar analizi ile kimya ve kirlenme açısından değerlendirilir.",
    section: "scheduled", applicableVehicleTypes: TRUCK, intervalDays: 365,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 340,
  },
  {
    id: "drive-axle-differential-oil",
    serviceType: "Drive Axle Oil",
    titleTr: "Drive axle ve diferansiyel yağı",
    descriptionTr: "Drive axle ve diferansiyel yağı üretici spesifikasyonuna göre değiştirilir.",
    section: "major", applicableVehicleTypes: TRUCK, intervalMiles: 180_000, intervalDays: 540,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 350,
    warningText: "Axle modeli ve VIN/build-sheet spesifikasyonu doğrulanmalıdır.",
  },
  {
    id: "def-filter-replacement",
    serviceType: "DEF Filter",
    titleTr: "DEF filtresi",
    descriptionTr: "DEF filtresi değiştirilir.",
    section: "major", applicableVehicleTypes: BOTH, intervalMiles: 250_000, intervalDays: 900,
    packageLevel: "full", defaultEnabled: true, defaultEnabledByVehicleType: { box_truck: false },
    equipmentRequirement: "diesel_aftertreatment", installMode: "reminder", sortOrder: 360,
    warningTextByVehicleType: { box_truck: "OEM aralığı ve diesel aftertreatment ekipmanı doğrulanmalıdır." },
  },
  {
    id: "dpf-ash-cleaning",
    serviceType: "DPF Cleaning",
    titleTr: "DPF sökülerek kül temizliği",
    descriptionTr: "DPF ölçüm ve OEM gerekliliklerine göre sökülerek kül temizliği yapılır.",
    section: "major", applicableVehicleTypes: BOTH, intervalMiles: 300_000, intervalDays: 900,
    packageLevel: "full", defaultEnabled: true, defaultEnabledByVehicleType: { box_truck: false },
    equipmentRequirement: "diesel_aftertreatment", installMode: "reminder", sortOrder: 370,
    warningTextByVehicleType: { box_truck: "OEM ve ölçüm sonuçlarına göre doğrulanmalıdır." },
  },
  {
    id: "valve-adjustment-overhead",
    serviceType: "Valve Overhead / Valve Adjustment",
    titleTr: "Valve adjustment / overhead",
    descriptionTr: "Valve overhead motor üreticisi prosedürüne göre kontrol edilir ve ayarlanır.",
    section: "major", applicableVehicleTypes: TRUCK, intervalMiles: 300_000, intervalDays: 1_095,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 380,
    warningText: "Motor modeli ve OEM programına göre doğrulanmalıdır.",
  },
  {
    id: "transmission-oil-service",
    serviceType: "Transmission Fluid Change",
    titleTr: "Şanzıman yağı değişimi",
    descriptionTr: "Şanzıman yağı üretici prosedürüne göre değiştirilir.",
    section: "major", applicableVehicleTypes: TRUCK, intervalMiles: 500_000, intervalDays: 1_460,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 390,
    warningText: "Şanzıman modeline ve kullanım şartına göre doğrulanmalıdır.",
  },
  {
    id: "engine-belt-planned-replacement",
    serviceType: "Engine Belt Replacement",
    titleTr: "Motor kayışları planlı değişim",
    descriptionTr: "Motor kayışları üretici prosedürüne göre planlı olarak değiştirilir.",
    section: "major", applicableVehicleTypes: TRUCK, intervalMiles: 450_000, intervalDays: 1_460,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 400,
  },
  {
    id: "engine-coolant-full-replacement",
    serviceType: "Coolant Service / Flush",
    titleTr: "Engine coolant tamamen değiştirme",
    descriptionTr: "Engine coolant tamamen boşaltılır ve doğrulanmış spesifikasyonla yenilenir.",
    section: "major", applicableVehicleTypes: TRUCK, intervalMiles: 750_000, intervalDays: 2_920, intervalEngineHours: 24_000,
    packageLevel: "full", defaultEnabled: true, installMode: "reminder", sortOrder: 410,
    warningText: "Coolant spesifikasyonu ve VIN/build-sheet bilgisi önceliklidir.",
  },
  {
    id: "paccar-first-valve-adjustment",
    serviceType: "PACCAR First Valve Adjustment",
    titleTr: "PACCAR ilk valve adjustment",
    descriptionTr: "Yalnızca doğrulanmış PACCAR MX motorlu unit için ilk servis hatırlatıcısıdır.",
    section: "major", applicableVehicleTypes: TRUCK, intervalMiles: 60_000,
    packageLevel: "full", defaultEnabled: false, engineRequirement: "paccar_mx", installMode: "reminder", sortOrder: 420,
    warningText: "Fleet-wide değildir; yalnızca seçilen PACCAR MX unit için bir kez kurulur.",
  },
];

export const MAINTENANCE_PROGRAM_REFERENCES: MaintenanceProgramReferenceItem[] = [
  {
    id: "driver-pre-trip-inspection", titleTr: "Şoför pre-trip kontrolü",
    descriptionTr: "Her gün ve her sefere çıkmadan yapılır; tarih/mileage reminder değildir.",
    applicableVehicleTypes: BOTH, installMode: "reference", sortOrder: 10,
  },
  {
    id: "fifth-wheel-visual-lock-check", titleTr: "Fifth wheel lock ve pull test",
    descriptionTr: "Her bağlantıda yapılır; periyodik reminder olarak kurulmaz.",
    applicableVehicleTypes: TRUCK, installMode: "reference", sortOrder: 20,
  },
  {
    id: "condition-based-clutch-replacement", titleTr: "Debriyaj değişimi",
    descriptionTr: "Arıza, ölçüm ve clutch-life verisine göre yapılır; sabit interval verilmez.",
    applicableVehicleTypes: TRUCK, installMode: "reference", sortOrder: 30,
  },
  {
    id: "clutch-expense-reserve", titleTr: "Debriyaj gider rezervi",
    descriptionTr: "350.000 mil bütçe planlama eşiğidir; bakımın yapılma zamanı değildir.",
    applicableVehicleTypes: TRUCK, installMode: "reference", sortOrder: 40,
  },
  {
    id: "condition-based-sensor-replacement", titleTr: "Sensör değişimi",
    descriptionTr: "Yalnızca test arızayı doğruladığında yapılır; sabit interval verilmez.",
    applicableVehicleTypes: BOTH, installMode: "reference", sortOrder: 50,
  },
];

export const MAINTENANCE_PROGRAM_EXCLUSIONS: MaintenanceProgramExclusion[] = [
  {
    id: "trailer-program-items",
    originalItem: "Trailer PM, trailer brake, trailer wheel-end, trailer door ve liftgate bakımları",
    applicableVehicleTypes: "none",
    reason: "Şirket power-only çalışıyor ve company-owned trailer yok. Global trailer desteği korunur; yalnızca bu installer dışında bırakılır.",
  },
  {
    id: "box-semi-transmission-assumptions",
    originalItem: "Semi Truck transmission uzun dönem varsayımları (Box Truck)",
    applicableVehicleTypes: "none",
    reason: "Box Truck şanzıman modeli doğrulanmadan Class 8 uzun dönem aralığı uygulanamaz.",
  },
  {
    id: "box-semi-drive-axle-assumptions",
    originalItem: "Semi Truck drive axle uzun dönem varsayımları (Box Truck)",
    applicableVehicleTypes: "none",
    reason: "Box Truck axle/build-sheet bilgisi doğrulanmadan Class 8 aralığı uygulanamaz.",
  },
  {
    id: "box-factory-elc-replacement",
    originalItem: "750.000 mil factory ELC replacement (Box Truck)",
    applicableVehicleTypes: "none",
    reason: "Box Truck coolant spesifikasyonu ve OEM aralığı doğrulanmadan uygulanamaz.",
  },
  {
    id: "box-clutch-life-monitoring",
    originalItem: "Clutch-life monitoring (Box Truck)",
    applicableVehicleTypes: "none",
    reason: "Uyumlu automated/manual clutch ekipmanı doğrulanmadığı için Box Truck programına eklenmez.",
  },
  {
    id: "cummins-fixed-engine-reminder",
    originalItem: "Ayrı Cummins-specific sabit reminder",
    applicableVehicleTypes: "none",
    reason: "Proje verisinde doğrulanmış ayrı bir Cummins programı bulunmadığından uydurma interval oluşturulmaz.",
  },
];

export function isMaintenanceProgramVehicleType(value: unknown): value is MaintenanceProgramVehicleType {
  return value === "truck" || value === "box_truck";
}

export function isMaintenancePackageLevel(value: unknown): value is MaintenancePackageLevel {
  return value === "basic" || value === "full";
}

export function maintenanceProgramPreset(id: string): MaintenanceProgramPreset | null {
  return MAINTENANCE_PROGRAM_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function presetAppliesToVehicleType(preset: MaintenanceProgramPreset, vehicleType: MaintenanceProgramVehicleType): boolean {
  return preset.applicableVehicleTypes.includes(vehicleType);
}

export function presetIsInPackage(
  preset: MaintenanceProgramPreset,
  vehicleType: MaintenanceProgramVehicleType,
  packageLevel: MaintenancePackageLevel,
): boolean {
  if (!presetAppliesToVehicleType(preset, vehicleType)) return false;
  if (packageLevel === "full") return true;
  return preset.packageLevel === "basic" || preset.basicVehicleTypes?.includes(vehicleType) === true;
}

export function getMaintenanceProgramPresets(
  vehicleType: MaintenanceProgramVehicleType,
  packageLevel: MaintenancePackageLevel,
  includeEngineSpecific = false,
): MaintenanceProgramPreset[] {
  return MAINTENANCE_PROGRAM_PRESETS
    .filter((preset) => preset.installMode === "reminder")
    .filter((preset) => presetIsInPackage(preset, vehicleType, packageLevel))
    .filter((preset) => includeEngineSpecific || !preset.engineRequirement)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function presetDefaultEnabled(preset: MaintenanceProgramPreset, vehicleType: MaintenanceProgramVehicleType): boolean {
  return preset.defaultEnabledByVehicleType?.[vehicleType] ?? preset.defaultEnabled;
}

export function presetWarning(preset: MaintenanceProgramPreset, vehicleType: MaintenanceProgramVehicleType): string | null {
  return preset.warningTextByVehicleType?.[vehicleType] ?? preset.warningText ?? null;
}

const DAY_LABELS = new Map<number, string>([
  [7, "7 gün"], [14, "14 gün"],
  [30, "1 ay"], [60, "2 ay"], [90, "3 ay"], [120, "4 ay"], [180, "6 ay"],
  [270, "9 ay"], [300, "10 ay"], [365, "12 ay"], [540, "18 ay"], [900, "30 ay"],
  [1_095, "3 yıl"], [1_460, "4 yıl"], [2_920, "8 yıl"],
]);

export function formatMaintenanceProgramInterval(values: {
  intervalMiles?: number | null;
  intervalDays?: number | null;
  intervalEngineHours?: number | null;
}): string {
  const parts: string[] = [];
  if (values.intervalMiles != null) parts.push(`${values.intervalMiles.toLocaleString("en-US")} mil`);
  if (values.intervalDays != null) parts.push(DAY_LABELS.get(values.intervalDays) ?? `${values.intervalDays.toLocaleString("tr-TR")} gün`);
  if (values.intervalEngineHours != null) parts.push(`${values.intervalEngineHours.toLocaleString("en-US")} engine saat`);
  return parts.join(" veya ") || "Interval yok";
}

export function findExistingProgramReminder(
  preset: MaintenanceProgramPreset,
  rules: MaintenanceProgramExistingRule[],
  vehicleType: MaintenanceProgramVehicleType,
  vehicleId?: string | null,
): MaintenanceProgramExistingRule | null {
  const targetKey = canonicalManualServiceKey("periodic", preset.serviceType);
  return rules.find((rule) => {
    if (!rule.active || canonicalManualServiceKey("periodic", rule.service_type) !== targetKey) return false;
    if (vehicleId) return rule.vehicle_id === vehicleId;
    return rule.vehicle_id == null && rule.vehicle_type === vehicleType;
  }) ?? null;
}

export function engineModelMatchesRequirement(
  engineModel: string | null | undefined,
  requirement: MaintenanceProgramEngineRequirement,
): boolean {
  const normalized = String(engineModel ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return false;
  if (requirement === "paccar_mx") return normalized.includes("paccar") && /\bmx\b|\bmx 11\b|\bmx 13\b/.test(normalized);
  return normalized.includes("cummins") && /\bx15\b/.test(normalized);
}

export function maintenanceProgramPrimaryIntervalType(values: {
  intervalMiles?: number | null;
  intervalDays?: number | null;
}): "mileage" | "date" | null {
  if (values.intervalMiles != null) return "mileage";
  if (values.intervalDays != null) return "date";
  return null;
}

export function validateMaintenanceProgramIntervals(values: {
  intervalMiles?: number | null;
  intervalDays?: number | null;
  intervalEngineHours?: number | null;
}): { ok: true } | { ok: false; error: string } {
  const intervals = [values.intervalMiles, values.intervalDays, values.intervalEngineHours];
  if (intervals.every((value) => value == null)) return { ok: false, error: "En az bir interval gerekli." };
  if (intervals.some((value) => value != null && (!Number.isInteger(value) || value <= 0))) {
    return { ok: false, error: "Intervaller pozitif tam sayı olmalı." };
  }
  if (maintenanceProgramPrimaryIntervalType(values) == null) {
    return { ok: false, error: "Yalnızca engine saat intervali desteklenmiyor; mil veya gün intervali ekleyin." };
  }
  return { ok: true };
}

const SOURCE_ITEM_NAMES: Record<string, string> = {
  "power-steering-fluid-check": "Power Steering Fluid Check",
  "transmission-fluid-leak-check": "Transmission Fluid & Leak Check",
  "fifth-wheel-lubrication": "Fifth Wheel Lubrication",
  "electronic-fault-scan": "Electronic Fault Scan",
  "brake-inspection": "Brake Inspection",
  "battery-connections-inspection": "Battery & Connections Inspection",
  "coolant-hose-inspection": "Coolant Hose Inspection",
  "engine-air-filter-inspection": "Motor air filter planning threshold / Engine Air Filter Inspection",
  "clutch-inspection": "Clutch Inspection",
  "suspension-steering-inspection": "Suspension Inspection / Suspension & Steering Inspection",
  "engine-oil-filter": "Engine Oil & Oil Filter",
  "fuel-filters": "Fuel Filters",
  "detailed-brake-wheel-end-inspection": "Detailed Brake & Wheel-End Inspection",
  "coolant-condition-check": "Coolant Condition Check",
  "dot-annual": "DOT Annual",
  "fuel-water-separator-drain": "Fuel Water Separator Drain",
  "air-tank-drain": "Air Tank Drain",
  "engine-emission-sensor-review": "Engine and Emission Sensor Review",
  "electrical-harness-connector-inspection": "Electrical Harness and Connector Inspection",
  "differential-axle-leak-inspection": "Differential and Axle Leak Inspection",
  "oil-pan-engine-leak-inspection": "Oil Pan / Engine Oil Leak Inspection",
  "cabin-air-filter-inspection": "Cabin Air Filter Inspection",
  "fifth-wheel-detailed-inspection": "Fifth Wheel Detailed Inspection",
  "engine-belt-tensioner-inspection": "Engine Belt and Tensioner Inspection",
  "abs-wheel-speed-sensor-inspection": "ABS Wheel-Speed Sensor Inspection",
  "u-bolt-suspension-fastener-inspection": "U-Bolt and Suspension Fastener Inspection",
  "battery-conductance-load-test": "Battery Conductance / Load Test",
  "cabin-air-filter-replacement": "Cabin Air Filter Replacement",
  "detailed-cooling-system-inspection": "Detailed Cooling System Inspection",
  "power-steering-fluid-filter-service": "Power Steering Fluid & Filter Service",
  "air-dryer-cartridge-purge-valve": "Air Dryer Cartridge & Purge Valve",
  "brake-chamber-inspection": "Brake Chamber Inspection (Box Truck air-brake option)",
  "slack-adjuster-inspection": "Slack Adjuster Inspection (Box Truck air-brake option)",
  "cooling-system-laboratory-analysis": "Cooling System Laboratory Analysis",
  "drive-axle-differential-oil": "Drive Axle / Differential Oil",
  "def-filter-replacement": "DEF Filter Replacement",
  "dpf-ash-cleaning": "DPF Ash Cleaning",
  "valve-adjustment-overhead": "Valve Adjustment / Overhead",
  "transmission-oil-service": "Transmission Oil Service",
  "engine-belt-planned-replacement": "Engine Belt Planned Replacement",
  "engine-coolant-full-replacement": "Engine Coolant Full Replacement",
  "paccar-first-valve-adjustment": "PACCAR First Valve Adjustment",
};

function applicabilityLabel(types: MaintenanceProgramVehicleType[]): string {
  if (types.length === 2) return "Semi Truck / Box Truck";
  return types[0] === "truck" ? "Semi Truck" : "Box Truck";
}

function presetCoverageReason(preset: MaintenanceProgramPreset): string {
  if (preset.id === "engine-air-filter-inspection") {
    return "20.000 mil / 60 gün inspection planıdır; replacement restriction/OEM sonucuna göre condition-based kalır.";
  }
  if (preset.engineRequirement === "paccar_mx") {
    return "Yalnızca doğrulanmış veya açıkça seçilmiş PACCAR MX unit için vehicle-specific kurulur.";
  }
  if (preset.defaultEnabledByVehicleType?.box_truck === false || preset.defaultEnabled === false) {
    return preset.warningTextByVehicleType?.box_truck ?? preset.warningText ?? "Ekipman doğrulaması gerektiği için varsayılan olarak seçilmez.";
  }
  if (preset.warningText || preset.warningTextByVehicleType) {
    return preset.warningText ?? preset.warningTextByVehicleType?.box_truck ?? "OEM doğrulaması gerekir.";
  }
  return "Supplied interval korunur; birden fazla sınır varsa ilk dolan sınır geçerlidir.";
}

export const MAINTENANCE_PROGRAM_SOURCE_COVERAGE: MaintenanceProgramCoverageRow[] = [
  ...MAINTENANCE_PROGRAM_PRESETS.map((preset) => ({
    originalItem: SOURCE_ITEM_NAMES[preset.id] ?? preset.serviceType,
    applicability: applicabilityLabel(preset.applicableVehicleTypes),
    disposition: "Reminder" as const,
    presetId: preset.id,
    interval: formatMaintenanceProgramInterval(preset),
    reason: presetCoverageReason(preset),
  })),
  ...MAINTENANCE_PROGRAM_REFERENCES.map((item) => ({
    originalItem: item.id === "condition-based-clutch-replacement"
      ? "Condition-based Clutch Replacement"
      : item.id === "clutch-expense-reserve"
        ? "Clutch Expense Reserve"
        : item.id === "condition-based-sensor-replacement"
          ? "Sensor Replacement"
          : item.id === "driver-pre-trip-inspection"
            ? "Driver Pre-Trip Inspection"
            : "Fifth Wheel Visual Lock Check",
    applicability: applicabilityLabel(item.applicableVehicleTypes),
    disposition: "Reference" as const,
    presetId: item.id,
    interval: "Condition / operasyon bazlı",
    reason: item.descriptionTr,
  })),
  ...MAINTENANCE_PROGRAM_EXCLUSIONS.map((item) => ({
    originalItem: item.originalItem,
    applicability: "Installer dışında",
    disposition: "Excluded" as const,
    presetId: item.id,
    interval: "-",
    reason: item.reason,
  })),
];

export const MAINTENANCE_TERMS = {
  addMaintenance: "Bakım Ekle",
  updateMileage: "Mileage Güncelle",
  startInspection: "Inspection Başlat",
  otherActions: "Diğer İşlemler",
  periodicMaintenance: "Periyodik Bakım",
  repair: "Tamir / Arıza",
  serviceType: "Bakım / Tamir Çeşidi",
  performedDate: "Yapılma Tarihi",
  performedMileage: "Yapıldığı Mileage",
  totalCost: "Toplam Maliyet",
  extraDetails: "Ek Detaylar",
  updateNextDue: "Sonraki bakım tarihini güncelle",
  advancedPlanSettings: "Gelişmiş plan ayarları",
  maintenancePlans: "Bakım Planları",
  lastDoneMaintenance: "Son Yapılan Bakım",
  mileageHistory: "Mileage Geçmişi",
  firstDueLimit: "İlk Dolan Sınır",
  plannedUnplanned: "Planlı / Plansız",
  insufficientMileage: "Mileage Verisi Yetersiz",
};

export function formatMaintenanceCategory(category: string): string {
  const labels: Record<string, string> = {
    routine_pm: "Rutin PM",
    tires: "Lastik",
    brakes_wheel_end: "Fren / Wheel-end",
    engine: "Motor",
    aftertreatment: "Aftertreatment",
    transmission_driveline: "Transmission / Driveline",
    suspension_steering: "Suspension / Steering",
    cooling: "Cooling",
    electrical: "Electrical",
    road_service_towing: "Road Service / Towing",
    driver_damage: "Driver Damage",
    warranty_recovery: "Warranty Recovery",
    other: "Diğer",
  };
  return labels[category] ?? category.replace(/_/g, " ");
}

import ResourceManager, { Field } from "@/components/ResourceManager";
import VehicleMileageManager from "@/components/VehicleMileageManager";
import { fetchRowsPaged, fetchOptions, parsePage } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const [paged, opts] = await Promise.all([
    fetchRowsPaged("vehicles", { page: parsePage(page) }),
    fetchOptions(),
  ]);

  const fields: Field[] = [
    { name: "unit_number", label: "Unit #", required: true },
    {
      name: "vehicle_type",
      label: "Tip",
      type: "select",
      required: true,
      options: [
        { value: "truck", label: "Truck" },
        { value: "box_truck", label: "Box Truck" },
        { value: "hotshot", label: "Hotshot" },
        { value: "trailer", label: "Trailer" },
        { value: "other", label: "Other" },
      ],
    },
    {
      name: "ownership_type",
      label: "Sahiplik",
      type: "select",
      required: true,
      options: [
        { value: "company_owned", label: "Company Owned" },
        { value: "owner_operator", label: "Owner Operator" },
        { value: "investor_managed", label: "Investor / Managed" },
        { value: "external_carrier_statement", label: "External Carrier Statement" },
        { value: "partner_carrier", label: "Partner Carrier" },
      ],
    },
    { name: "company_id", label: "Şirket", type: "select", options: opts.companies, hideInTable: true },
    { name: "external_carrier_id", label: "External Carrier", type: "select", options: opts.carriers, hideInTable: true },
    { name: "owner_id", label: "Owner / Investor", type: "select", options: opts.owners, hideInTable: true },
    { name: "assigned_driver_id", label: "Şoför", type: "select", options: opts.drivers },
    { name: "default_driver_pay_pct", label: "Driver %", type: "percent" },
    { name: "company_fee_pct", label: "Company Fee %", type: "percent" },
    { name: "company_fee_is_our_revenue", label: "Fee bize mi?", type: "checkbox", hideInTable: true },
    { name: "external_carrier_fee_pct", label: "Ext. Carrier Fee %", type: "percent", hideInTable: true },
    {
      name: "management_commission_type",
      label: "Komisyon Tipi",
      type: "select",
      hideInTable: true,
      options: [
        { value: "none", label: "Yok" },
        { value: "flat", label: "Sabit ($)" },
        { value: "percent", label: "Yüzde (%)" },
      ],
    },
    { name: "management_commission_amount", label: "Komisyon", type: "number", step: "0.01", hideInTable: true },
    { name: "vin", label: "VIN", hideInTable: true },
    { name: "year", label: "Yıl", type: "number", hideInTable: true },
    { name: "make", label: "Make", hideInTable: true },
    { name: "model", label: "Model", hideInTable: true },
    { name: "plate", label: "Plaka", hideInTable: true },
    {
      name: "current_mileage",
      label: "Initial Mileage",
      type: "number",
      step: "1",
      hideInTable: true,
      createOnly: true,
    },
    {
      name: "status",
      label: "Durum",
      type: "select",
      required: true,
      options: [
        { value: "active", label: "Aktif" },
        { value: "in_repair", label: "Tamirde" },
        { value: "inactive", label: "Pasif" },
      ],
    },
    { name: "notes", label: "Not", type: "textarea", hideInTable: true },
  ];

  return (
    <div className="space-y-4">
      <VehicleMileageManager
        vehicles={paged.rows.map((row) => ({
          id: row.id,
          unit_number: row.unit_number,
          current_mileage: row.current_mileage,
        }))}
      />
      <ResourceManager
        title="Vehicles / Units"
        table="vehicles"
        basePath="/vehicles"
      addLabel="Araç"
        fields={fields}
        rows={paged.rows}
        pagination={{ page: paged.page, pageSize: paged.pageSize, total: paged.total }}
      />
    </div>
  );
}

import type { Field } from "@/components/ResourceManager";
import VehicleResourceManager from "@/components/VehicleResourceManager";
import { requireProfile } from "@/lib/auth";
import { DEFAULT_PAGE_SIZE, fetchOptions, parsePage } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; showInactive?: string }>;
}) {
  const { page, showInactive } = await searchParams;
  const includeInactive = showInactive === "1";
  const currentPage = parsePage(page);
  const from = (currentPage - 1) * DEFAULT_PAGE_SIZE;
  const profile = await requireProfile();
  const canPermanentDelete = profile.role === "owner" || profile.role === "admin";
  const supabase = await createClient();

  let vehiclesQuery = supabase
    .from("vehicles")
    .select("*", { count: "exact" })
    .order("unit_number", { ascending: true })
    .range(from, from + DEFAULT_PAGE_SIZE - 1);
  if (!includeInactive) vehiclesQuery = vehiclesQuery.in("status", ["active", "in_repair"]);

  const [vehiclesRes, opts] = await Promise.all([
    vehiclesQuery,
    fetchOptions(),
  ]);
  const queryError = vehiclesRes.error;
  if (queryError) throw new Error(`Vehicle maintenance data failed to load: ${queryError.message}`);

  const paged = {
    rows: vehiclesRes.data ?? [],
    total: vehiclesRes.count ?? 0,
    page: currentPage,
    pageSize: DEFAULT_PAGE_SIZE,
  };

  const fields: Field[] = [
    { name: "unit_number", label: "Unit #", required: true },
    {
      name: "vehicle_type",
      label: "Tip",
      type: "select",
      required: true,
      hideOnCreate: true,
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
      hideInTable: true,
      hideOnCreate: true,
      options: [
        { value: "company_owned", label: "Company Owned" },
        { value: "owner_operator", label: "Owner Operator" },
        { value: "investor_managed", label: "Investor / Managed" },
        { value: "external_carrier_statement", label: "External Carrier Statement" },
        { value: "partner_carrier", label: "Partner Carrier" },
      ],
    },
    { name: "company_id", label: "Şirket", type: "select", options: opts.companies, hideInTable: true, hideOnCreate: true },
    { name: "external_carrier_id", label: "External Carrier", type: "select", options: opts.carriers, hideInTable: true, hideOnCreate: true },
    { name: "owner_id", label: "Owner / Investor", type: "select", options: opts.owners, hideInTable: true, hideOnCreate: true },
    { name: "assigned_driver_id", label: "Şoför", type: "select", options: opts.drivers, hideOnCreate: true },
    { name: "default_driver_pay_pct", label: "Driver %", type: "percent", hideInTable: true, hideOnCreate: true },
    { name: "company_fee_pct", label: "Company Fee %", type: "percent", hideInTable: true, hideOnCreate: true },
    { name: "company_fee_is_our_revenue", label: "Fee bize mi?", type: "checkbox", hideInTable: true, hideOnCreate: true },
    { name: "external_carrier_fee_pct", label: "Ext. Carrier Fee %", type: "percent", hideInTable: true, hideOnCreate: true },
    {
      name: "management_commission_type",
      label: "Komisyon Tipi",
      type: "select",
      hideInTable: true,
      hideOnCreate: true,
      options: [
        { value: "none", label: "Yok" },
        { value: "flat", label: "Sabit ($)" },
        { value: "percent", label: "Yüzde (%)" },
      ],
    },
    { name: "management_commission_amount", label: "Komisyon", type: "number", step: "0.01", hideInTable: true, hideOnCreate: true },
    { name: "vin", label: "VIN", hideInTable: true, hideOnCreate: true },
    { name: "year", label: "Yıl", type: "number", hideInTable: true, hideOnCreate: true },
    { name: "make", label: "Make", hideInTable: true, hideOnCreate: true },
    { name: "model", label: "Model", hideInTable: true, hideOnCreate: true },
    { name: "plate", label: "Plaka", hideInTable: true, hideOnCreate: true },
    {
      name: "current_mileage",
      label: "Current Mileage",
      type: "number",
      step: "1",
      createOnly: true,
    },
    {
      name: "status",
      label: "Durum",
      type: "select",
      required: true,
      hideOnCreate: true,
      options: [
        { value: "active", label: "Aktif" },
        { value: "in_repair", label: "Tamirde" },
        { value: "inactive", label: "Pasif" },
      ],
    },
    { name: "notes", label: "Not", type: "textarea", hideInTable: true, hideOnCreate: true },
  ];

  return (
    <VehicleResourceManager
      fields={fields}
      rows={paged.rows}
      pagination={{ page: paged.page, pageSize: paged.pageSize, total: paged.total }}
      includeInactive={includeInactive}
      canPermanentDelete={canPermanentDelete}
    />
  );
}

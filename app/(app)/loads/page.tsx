import ResourceManager, { Field } from "@/components/ResourceManager";
import { fetchRows, fetchOptions } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function LoadsPage() {
  const [rows, opts] = await Promise.all([
    fetchRows("loads", { order: "delivery_date" }),
    fetchOptions(),
  ]);

  const fields: Field[] = [
    { name: "load_number", label: "Load #" },
    {
      name: "load_source",
      label: "Kaynak",
      type: "select",
      options: [
        { value: "amazon_relay", label: "Amazon Relay" },
        { value: "street_load", label: "Street Load" },
        { value: "broker", label: "Broker" },
        { value: "dat", label: "DAT" },
        { value: "direct_customer", label: "Direct Customer" },
        { value: "other", label: "Other" },
      ],
    },
    { name: "vehicle_id", label: "Araç", type: "select", options: opts.vehicles },
    { name: "driver_id", label: "Şoför", type: "select", options: opts.drivers },
    { name: "company_id", label: "Şirket", type: "select", options: opts.companies, hideInTable: true },
    { name: "external_carrier_id", label: "Ext. Carrier", type: "select", options: opts.carriers, hideInTable: true },
    { name: "pickup_date", label: "Pickup", type: "date", hideInTable: true },
    { name: "delivery_date", label: "Teslim", type: "date" },
    { name: "pickup_location", label: "Pickup Yeri", hideInTable: true },
    { name: "delivery_location", label: "Teslim Yeri", hideInTable: true },
    { name: "route", label: "Güzergah" },
    { name: "gross_amount", label: "Gross", type: "money", required: true },
    { name: "fuel_surcharge", label: "Fuel Surcharge", type: "money", hideInTable: true },
    { name: "loaded_miles", label: "Loaded Miles", type: "number", hideInTable: true },
    { name: "empty_miles", label: "Empty Miles", type: "number", hideInTable: true },
    { name: "total_miles", label: "Toplam Mil", type: "number" },
    {
      name: "status",
      label: "Durum",
      type: "select",
      options: [
        { value: "pending", label: "Pending" },
        { value: "booked", label: "Booked" },
        { value: "delivered", label: "Delivered" },
        { value: "paid", label: "Paid" },
        { value: "cancelled", label: "Cancelled" },
        { value: "rejected", label: "Rejected" },
      ],
    },
    { name: "notes", label: "Not", type: "textarea", hideInTable: true },
  ];

  return (
    <ResourceManager
      title="Loads"
      table="loads"
      basePath="/loads"
      addLabel="Load"
      fields={fields}
      rows={rows}
    />
  );
}

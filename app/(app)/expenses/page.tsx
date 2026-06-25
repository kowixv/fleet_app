import ResourceManager, { Field } from "@/components/ResourceManager";
import { fetchRows, fetchOptions } from "@/lib/data";

export const dynamic = "force-dynamic";

const CATEGORIES = [
  "fuel", "def", "fees", "insurance", "eld", "ifta", "tolls", "repair",
  "maintenance", "advance", "trailer_rental", "chargeback", "comcheck", "misc", "other",
];

export default async function ExpensesPage() {
  const [rows, opts] = await Promise.all([
    fetchRows("expenses", { order: "date" }),
    fetchOptions(),
  ]);

  const fields: Field[] = [
    { name: "date", label: "Tarih", type: "date", required: true },
    {
      name: "category",
      label: "Kategori",
      type: "select",
      required: true,
      options: CATEGORIES.map((c) => ({ value: c, label: c.replace(/_/g, " ") })),
    },
    { name: "amount", label: "Tutar", type: "money", required: true },
    { name: "vehicle_id", label: "Araç", type: "select", options: opts.vehicles },
    { name: "driver_id", label: "Şoför", type: "select", options: opts.drivers, hideInTable: true },
    { name: "owner_id", label: "Owner/Investor", type: "select", options: opts.owners, hideInTable: true },
    { name: "company_id", label: "Şirket", type: "select", options: opts.companies, hideInTable: true },
    { name: "external_carrier_id", label: "Ext. Carrier", type: "select", options: opts.carriers, hideInTable: true },
    { name: "deduct_from_settlement", label: "Settlement'tan düş", type: "checkbox" },
    { name: "notes", label: "Not", type: "textarea", hideInTable: true },
  ];

  return (
    <ResourceManager
      title="Expenses"
      table="expenses"
      basePath="/expenses"
      addLabel="Masraf"
      fields={fields}
      rows={rows}
    />
  );
}

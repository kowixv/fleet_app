import ResourceManager, { Field } from "@/components/ResourceManager";
import { fetchRows } from "@/lib/data";

export const dynamic = "force-dynamic";

const fields: Field[] = [
  { name: "full_name", label: "Ad Soyad", required: true },
  {
    name: "type",
    label: "Tip",
    type: "select",
    required: true,
    options: [
      { value: "company_driver", label: "Company Driver" },
      { value: "owner_operator", label: "Owner Operator" },
      { value: "investor", label: "Investor / Owner" },
      { value: "external_carrier_driver", label: "External Carrier Driver" },
    ],
  },
  { name: "phone", label: "Telefon" },
  { name: "email", label: "Email", hideInTable: true },
  { name: "default_pay_pct", label: "Pay %", type: "percent" },
  { name: "default_insurance_deduction", label: "Sigorta Kesinti", type: "money", hideInTable: true },
  { name: "default_eld_ifta_deduction", label: "ELD/IFTA Kesinti", type: "money", hideInTable: true },
  {
    name: "status",
    label: "Durum",
    type: "select",
    required: true,
    options: [
      { value: "active", label: "Aktif" },
      { value: "inactive", label: "Pasif" },
    ],
  },
  { name: "notes", label: "Not", type: "textarea", hideInTable: true },
];

export default async function PeoplePage() {
  const rows = await fetchRows("people");
  return (
    <ResourceManager
      title="Drivers / Owners / Investors"
      table="people"
      basePath="/people"
      addLabel="Kişi"
      fields={fields}
      rows={rows}
    />
  );
}

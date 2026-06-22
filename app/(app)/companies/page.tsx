import ResourceManager, { Field } from "@/components/ResourceManager";
import { fetchRows } from "@/lib/data";

export const dynamic = "force-dynamic";

const fields: Field[] = [
  { name: "name", label: "Şirket Adı", required: true },
  { name: "scac", label: "SCAC" },
  { name: "mc_number", label: "MC #", hideInTable: true },
  { name: "usdot_number", label: "USDOT #", hideInTable: true },
  { name: "notes", label: "Not", type: "textarea", hideInTable: true },
];

export default async function CompaniesPage() {
  const rows = await fetchRows("companies");
  return (
    <ResourceManager
      title="Companies"
      table="companies"
      basePath="/companies"
      addLabel="Şirket"
      fields={fields}
      rows={rows}
    />
  );
}

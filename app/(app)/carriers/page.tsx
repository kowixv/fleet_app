import ResourceManager, { Field } from "@/components/ResourceManager";
import { fetchRows } from "@/lib/data";

export const dynamic = "force-dynamic";

const fields: Field[] = [
  { name: "name", label: "Carrier Adı", required: true },
  { name: "default_commission", label: "Varsayılan Komisyon", type: "money" },
  { name: "notes", label: "Not", type: "textarea", hideInTable: true },
];

export default async function CarriersPage() {
  const rows = await fetchRows("external_carriers");
  return (
    <ResourceManager
      title="External Carriers"
      table="external_carriers"
      basePath="/carriers"
      addLabel="Carrier"
      fields={fields}
      rows={rows}
    />
  );
}

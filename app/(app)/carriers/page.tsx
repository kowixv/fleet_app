import ResourceManager, { Field } from "@/components/ResourceManager";
import { fetchRowsPaged, parsePage } from "@/lib/data";

export const dynamic = "force-dynamic";

const fields: Field[] = [
  { name: "name", label: "Carrier Adı", required: true },
  { name: "default_commission", label: "Varsayılan Komisyon", type: "money" },
  { name: "notes", label: "Not", type: "textarea", hideInTable: true },
];

export default async function CarriersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const paged = await fetchRowsPaged("external_carriers", { page: parsePage(page) });
  return (
    <ResourceManager
      title="External Carriers"
      table="external_carriers"
      basePath="/carriers"
      addLabel="Carrier"
      fields={fields}
      rows={paged.rows}
      pagination={{ page: paged.page, pageSize: paged.pageSize, total: paged.total }}
    />
  );
}

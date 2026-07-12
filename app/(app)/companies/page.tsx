import ResourceManager, { Field } from "@/components/ResourceManager";
import { fetchRowsPaged, parsePage } from "@/lib/data";

export const dynamic = "force-dynamic";

const fields: Field[] = [
  { name: "name", label: "Şirket Adı", required: true },
  { name: "scac", label: "SCAC" },
  { name: "mc_number", label: "MC #", hideInTable: true },
  { name: "usdot_number", label: "USDOT #", hideInTable: true },
  { name: "notes", label: "Not", type: "textarea", hideInTable: true },
];

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const paged = await fetchRowsPaged("companies", { page: parsePage(page) });
  return (
    <ResourceManager
      title="Companies"
      table="companies"
      basePath="/companies"
      addLabel="Şirket"
      fields={fields}
      rows={paged.rows}
      pagination={{ page: paged.page, pageSize: paged.pageSize, total: paged.total }}
    />
  );
}

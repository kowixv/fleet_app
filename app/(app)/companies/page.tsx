import Link from "next/link";
import ResourceManager, { Field } from "@/components/ResourceManager";
import { fetchRowsPaged, parsePage } from "@/lib/data";

export const dynamic = "force-dynamic";

const companyFields: Field[] = [
  { name: "name", label: "Şirket Adı", required: true },
  { name: "scac", label: "SCAC" },
  { name: "mc_number", label: "MC #", hideInTable: true },
  { name: "usdot_number", label: "USDOT #", hideInTable: true },
  { name: "notes", label: "Not", type: "textarea", hideInTable: true },
];

const carrierFields: Field[] = [
  { name: "name", label: "Carrier Adı", required: true },
  { name: "default_commission", label: "Varsayılan Komisyon", type: "money" },
  { name: "notes", label: "Not", type: "textarea", hideInTable: true },
];

type PartnerView = "company" | "carrier";

const views: {
  value: PartnerView;
  label: string;
  description: string;
}[] = [
  {
    value: "company",
    label: "Companies",
    description: "Kendi şirket kayıtlarınızı yönetin.",
  },
  {
    value: "carrier",
    label: "External Carriers",
    description: "Çalıştığınız dış carrier kayıtlarını yönetin.",
  },
];

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  const params = await searchParams;
  const view: PartnerView = params.type === "carrier" ? "carrier" : "company";
  const page = parsePage(params.page);
  const isCarrier = view === "carrier";
  const paged = await fetchRowsPaged(isCarrier ? "external_carriers" : "companies", { page });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Companies / Carriers</h1>
        <p className="mt-1 text-sm text-slate-500">
          Kayıt türünü seçerek şirketleri ve external carrier&apos;ları aynı modülden yönetin.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2" aria-label="Kayıt türü">
        {views.map((item) => {
          const active = item.value === view;
          return (
            <Link
              key={item.value}
              href={`/companies?type=${item.value}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-xl border p-4 transition ${
                active
                  ? "border-brand bg-brand/5 ring-1 ring-brand"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span className={`block text-sm font-semibold ${active ? "text-brand" : "text-slate-800"}`}>
                {item.label}
              </span>
              <span className="mt-1 block text-xs text-slate-500">{item.description}</span>
            </Link>
          );
        })}
      </div>

      <ResourceManager
        title={isCarrier ? "External Carriers" : "Companies"}
        headingLevel="h2"
        table={isCarrier ? "external_carriers" : "companies"}
        basePath="/companies"
        addLabel={isCarrier ? "Carrier" : "Şirket"}
        fields={isCarrier ? carrierFields : companyFields}
        rows={paged.rows}
        pagination={{ page: paged.page, pageSize: paged.pageSize, total: paged.total }}
        paginationParams={{ type: view }}
      />
    </div>
  );
}

"use client";

import ResourceManager, { type Field, type Pagination } from "@/components/ResourceManager";
import VehicleRemovalActions from "@/components/VehicleRemovalActions";

export default function VehicleResourceManager({
  fields,
  rows,
  pagination,
  includeInactive,
  canPermanentDelete,
}: {
  fields: Field[];
  rows: Record<string, any>[];
  pagination: Pagination;
  includeInactive: boolean;
  canPermanentDelete: boolean;
}) {
  function paginationHref(nextPage: number) {
    return `/vehicles?page=${nextPage}${includeInactive ? "&showInactive=1" : ""}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <a className="btn-ghost" href={includeInactive ? "/vehicles" : "/vehicles?showInactive=1"}>
          {includeInactive ? "Pasif Unitleri Gizle" : "Pasif Unitleri Göster"}
        </a>
      </div>
      <ResourceManager
        title="Vehicles / Units"
        table="vehicles"
        basePath="/vehicles"
        addLabel="Araç"
        fields={fields}
        rows={rows}
        pagination={pagination}
        paginationHref={paginationHref}
        renderActions={(row, actions) => (
          <VehicleRemovalActions
            row={{ id: row.id, unit_number: row.unit_number, status: row.status }}
            startEdit={(vehicle) => actions.startEdit(vehicle)}
            canPermanentDelete={canPermanentDelete}
          />
        )}
      />
    </div>
  );
}

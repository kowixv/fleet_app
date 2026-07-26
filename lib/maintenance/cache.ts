import "server-only";

import { revalidatePath } from "next/cache";
import {
  maintenanceInvalidationPaths,
  type MaintenanceCacheScope,
} from "@/lib/maintenance/cache-policy";

export { maintenanceInvalidationPaths };

export function revalidateMaintenance(scope: MaintenanceCacheScope): void {
  for (const path of maintenanceInvalidationPaths(scope)) revalidatePath(path);
}

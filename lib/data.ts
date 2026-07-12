import { createClient } from "@/lib/supabase/server";

/** Fetch all rows of a table for the current org (RLS scopes it).
 *  Only for small, bounded tables — unbounded lists silently truncate at
 *  PostgREST's 1000-row cap; use fetchRowsPaged for those. */
export async function fetchRows(
  table: string,
  opts?: { order?: string; ascending?: boolean },
) {
  const supabase = await createClient();
  const { data } = await supabase
    .from(table)
    .select("*")
    .order(opts?.order ?? "created_at", { ascending: opts?.ascending ?? false });
  return data ?? [];
}

export const DEFAULT_PAGE_SIZE = 50;

/** Paged fetch with exact total count for list pages. `page` is 1-based. */
export async function fetchRowsPaged(
  table: string,
  opts?: { order?: string; ascending?: boolean; page?: number; pageSize?: number },
): Promise<{ rows: Record<string, any>[]; total: number; page: number; pageSize: number }> {
  const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, opts?.page ?? 1);
  const from = (page - 1) * pageSize;
  const supabase = await createClient();
  const { data, count } = await supabase
    .from(table)
    .select("*", { count: "exact" })
    .order(opts?.order ?? "created_at", { ascending: opts?.ascending ?? false })
    .range(from, from + pageSize - 1);
  return { rows: data ?? [], total: count ?? 0, page, pageSize };
}

/** Parse a 1-based page number from a searchParams value. */
export function parsePage(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Build select <option> lists for relation fields. */
export async function fetchOptions() {
  const supabase = await createClient();
  const [companies, carriers, people, vehicles] = await Promise.all([
    supabase.from("companies").select("id, name").order("name"),
    supabase.from("external_carriers").select("id, name").order("name"),
    supabase.from("people").select("id, full_name, type").order("full_name"),
    supabase.from("vehicles").select("id, unit_number").order("unit_number"),
  ]);
  const map = <T,>(rows: T[] | null, label: (r: T) => string, value: (r: T) => string) =>
    (rows ?? []).map((r) => ({ value: value(r), label: label(r) }));
  return {
    companies: map(companies.data, (r: any) => r.name, (r: any) => r.id),
    carriers: map(carriers.data, (r: any) => r.name, (r: any) => r.id),
    people: map(people.data, (r: any) => r.full_name, (r: any) => r.id),
    drivers: map(
      (people.data ?? []).filter(
        (r: any) => r.type === "company_driver" || r.type === "external_carrier_driver",
      ),
      (r: any) => r.full_name,
      (r: any) => r.id,
    ),
    owners: map(
      (people.data ?? []).filter(
        (r: any) => r.type === "owner_operator" || r.type === "investor",
      ),
      (r: any) => r.full_name,
      (r: any) => r.id,
    ),
    vehicles: map(vehicles.data, (r: any) => r.unit_number, (r: any) => r.id),
  };
}

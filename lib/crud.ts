"use server";

import { createClient } from "@/lib/supabase/server";
import { requireWriteRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { clean, isAllowedTable } from "@/lib/crud-allowlist";

/**
 * Generic CRUD server actions. Security: the table must be in the allowlist,
 * only allowlisted columns are written, and organization_id always comes from
 * the session — never from the client. The allowlist itself lives in
 * `lib/crud-allowlist.ts` (testable, non-"use server").
 * Write operations require at least `manager` role; `viewer` is rejected.
 */

export async function createRow(
  table: string,
  values: Record<string, unknown>,
  revalidate?: string,
) {
  const profile = await requireWriteRole();
  const supabase = await createClient();
  const row = { ...clean(table, values), organization_id: profile.organization_id };
  const { error } = await supabase.from(table).insert(row);
  if (error) return { error: error.message };
  if (revalidate) revalidatePath(revalidate);
  return { ok: true };
}

export async function updateRow(
  table: string,
  id: string,
  values: Record<string, unknown>,
  revalidate?: string,
) {
  await requireWriteRole();
  const supabase = await createClient();
  const { error } = await supabase.from(table).update(clean(table, values)).eq("id", id);
  if (error) return { error: error.message };
  if (revalidate) revalidatePath(revalidate);
  return { ok: true };
}

export async function deleteRow(table: string, id: string, revalidate?: string) {
  if (!isAllowedTable(table)) throw new Error(`Table not allowed: ${table}`);
  await requireWriteRole();
  const supabase = await createClient();
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) return { error: error.message };
  if (revalidate) revalidatePath(revalidate);
  return { ok: true };
}

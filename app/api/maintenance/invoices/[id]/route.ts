import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireProfile();
  const { id } = await params;
  const supabase = await createClient();
  const { data: invoice, error } = await supabase
    .from("maintenance_invoices")
    .select("storage_path")
    .eq("id", id)
    .single();
  if (error || !invoice) return new Response("Invoice not found", { status: 404 });

  const service = createServiceClient();
  const { data, error: signedError } = await service.storage
    .from("maintenance-invoices")
    .createSignedUrl(invoice.storage_path, 60);
  if (signedError || !data?.signedUrl) return new Response("Invoice unavailable", { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}

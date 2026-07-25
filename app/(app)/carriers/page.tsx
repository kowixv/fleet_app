import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function CarriersPage() {
  redirect("/companies?type=carrier");
}

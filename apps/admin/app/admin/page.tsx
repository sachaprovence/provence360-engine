import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/actor";

export const dynamic = "force-dynamic";

export default async function AdminRootPage() {
  await requireCurrentUser(); // redirects to /login if not authenticated
  redirect("/admin/tenants");
}

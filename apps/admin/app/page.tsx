import { redirect } from "next/navigation";
import { getCurrentUserOrNull } from "@/lib/actor";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const user = await getCurrentUserOrNull();
  redirect(user ? "/admin/tenants" : "/login");
}

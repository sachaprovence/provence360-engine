import { redirect } from "next/navigation";
import { getCurrentUserOrNull } from "@/lib/actor";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUserOrNull();
  if (user) redirect("/admin/tenants");

  return (
    <main style={{ maxWidth: 400, margin: "6rem auto", padding: "0 1.5rem" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Provence360 Control Plane</h1>
      <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 24 }}>Sign in to continue.</p>
      <LoginForm />
    </main>
  );
}

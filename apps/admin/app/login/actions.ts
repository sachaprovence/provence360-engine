"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { InvalidCredentialsError, LoginRateLimitedError, login } from "@provence360/auth";
import { setSessionCookie } from "@/lib/session-cookie";

// Loose on purpose: this only decides "is it worth calling login() at
// all," never "is this a real email" — that distinction (does an account
// with this address exist) is exactly what must never leak from a format
// validator into a response the client can distinguish.
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(255),
  password: z.string().min(1).max(512),
});

export interface LoginActionState {
  error?: string;
}

export async function loginAction(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Enter your email and password." };
  }

  try {
    const result = await login(parsed.data.email, parsed.data.password);
    await setSessionCookie(result.token, result.expiresAt);
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      return { error: "Invalid email or password." };
    }
    if (error instanceof LoginRateLimitedError) {
      return { error: "Too many attempts. Try again in a few minutes." };
    }
    throw error;
  }

  redirect("/admin/tenants");
}

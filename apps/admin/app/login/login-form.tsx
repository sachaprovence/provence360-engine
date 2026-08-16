"use client";

import { useActionState } from "react";
import { loginAction, type LoginActionState } from "./actions";

const initialState: LoginActionState = {};

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} style={{ display: "grid", gap: 12, maxWidth: 320 }}>
      <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
        Email
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          autoFocus
          style={{ padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6 }}
        />
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
        Password
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          style={{ padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6 }}
        />
      </label>
      {state.error ? (
        <p role="alert" style={{ color: "#b91c1c", fontSize: 14, margin: 0 }}>
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        style={{
          padding: "8px 10px",
          borderRadius: 6,
          border: "none",
          background: "#111827",
          color: "white",
          fontWeight: 600,
          cursor: isPending ? "default" : "pointer",
          opacity: isPending ? 0.7 : 1,
        }}
      >
        {isPending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

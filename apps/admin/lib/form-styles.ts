// Shared inline-style constants for the Site Editor's admin forms/tables
// (packages/rentals/content/themes UI, v0.3) — the rest of the Control
// Plane duplicates small style objects per file; this batch of new pages
// is large enough that duplicating them another dozen times would be
// worse than one shared, deliberately tiny module.
export const inputStyle = { padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6 };

export const textareaStyle = {
  ...inputStyle,
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  width: "100%",
  minHeight: 120,
};

export const buttonStyle = {
  padding: "7px 12px",
  borderRadius: 6,
  border: "none",
  background: "#111827",
  color: "white",
  fontSize: 13,
  cursor: "pointer",
};

export const secondaryButtonStyle = {
  ...buttonStyle,
  background: "white",
  color: "#111827",
  border: "1px solid #d1d5db",
};

export const dangerButtonStyle = {
  ...buttonStyle,
  background: "white",
  color: "#b91c1c",
  border: "1px solid #fecaca",
};

export const labelStyle = { display: "grid", gap: 4, fontSize: 13 };

export const errorTextStyle = { color: "#b91c1c", fontSize: 13 };

export const tableStyle = { width: "100%", borderCollapse: "collapse" as const, fontSize: 14 };
export const thStyle = {
  padding: "6px 4px",
  textAlign: "left" as const,
  borderBottom: "1px solid #e5e7eb",
};
export const tdStyle = { padding: "6px 4px", borderBottom: "1px solid #f3f4f6" };

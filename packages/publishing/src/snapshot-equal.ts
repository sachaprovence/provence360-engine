/**
 * Recursively sorts object keys (arrays are left in place — page/block
 * order is meaningful and must never be reordered) so two structurally
 * identical values compare equal via JSON.stringify regardless of key
 * insertion order. Needed specifically because `site_revisions.snapshot`
 * round-trips through Postgres JSONB: JSONB does not preserve a JS
 * object's original key insertion order, so a snapshot built fresh
 * in-process and the *same* snapshot read back after being stored can
 * legitimately differ in key order alone. A plain `JSON.stringify(a) ===
 * JSON.stringify(b)` would then wrongly report "changed" for an
 * unpublished-changes check that never actually changed.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Structural (key-order-independent) equality for two snapshot-shaped JSON values. */
export function snapshotsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

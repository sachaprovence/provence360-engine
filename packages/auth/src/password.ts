import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

// Argon2id via @node-rs/argon2 (native Rust binding, prebuilt binaries —
// no node-gyp compile step). Argon2id is OWASP's current recommendation
// for password hashing; the defaults below follow OWASP's password
// storage cheat sheet (m=19MiB, t=2, p=1 is the "if in doubt" baseline —
// tuned up slightly here since this runs server-side, not on constrained
// hardware). See docs/adr/0006-authentication-strategy.md.
const ARGON2_OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hashes a plaintext password. Never store or log the input. */
export async function hashPassword(plainTextPassword: string): Promise<string> {
  return argon2Hash(plainTextPassword, ARGON2_OPTIONS);
}

/**
 * Verifies a plaintext password against a stored hash. Constant-time by
 * construction (argon2's own verify, not a manual string compare) — never
 * replace this with `hash === stored`.
 */
export async function verifyPassword(hash: string, plainTextPassword: string): Promise<boolean> {
  return argon2Verify(hash, plainTextPassword);
}

import { eq } from "drizzle-orm";
import { users } from "@provence360/database";
import { getAuthDb } from "@provence360/database/client-auth";

export interface UserLookup {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Finds an existing user by email — used only by "add an existing user as
 * a member of this tenant" (packages/auth/src/membership-repository.ts's
 * caller in apps/admin). There is no self-service signup in v0.2 (see
 * docs/ROADMAP.md): this can only ever add someone who already has an
 * account, never create one.
 */
export async function findUserByEmail(rawEmail: string): Promise<UserLookup | null> {
  const email = rawEmail.trim().toLowerCase();
  const [row] = await getAuthDb()
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.email, email));
  return row ?? null;
}

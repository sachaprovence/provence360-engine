import { randomUUID } from "node:crypto";
import { z } from "zod";

/**
 * The envelope every stored block instance is wrapped in, regardless of
 * type. `id` is stable across edits/reorders (section 18 of the brief) —
 * generated once at creation, never regenerated. `props`'s actual shape is
 * whatever `type@version`'s registered schema says (see
 * block-registry.ts); at this layer it's deliberately `unknown`, not yet
 * validated.
 */
export const blockEnvelopeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.string().min(1).max(64),
  version: z.number().int().positive(),
  props: z.unknown(),
});

export type BlockEnvelope = z.infer<typeof blockEnvelopeSchema>;

const BLOCK_ID_PREFIX = "blk_";

/** A fresh, stable instance id for a new block — never reused across a page's lifetime. */
export function generateBlockInstanceId(): string {
  return `${BLOCK_ID_PREFIX}${randomUUID()}`;
}

import { z } from "zod";

/** Any RFC 9562 UUID (v4 random or v7 time-ordered) used as a primary key. */
export const uuidSchema = z.uuid();

export type Uuid = z.infer<typeof uuidSchema>;

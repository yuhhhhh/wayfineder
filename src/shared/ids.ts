import { createHash, randomUUID } from "node:crypto";
import type { IdGenerator } from "./types.js";

export const randomIdGenerator: IdGenerator = {
  next: () => randomUUID(),
};

export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24);
}

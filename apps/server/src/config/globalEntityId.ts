import { z } from "zod";

export const GlobalEntityIdSchema = z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9_-]+$/);
const DEFAULT_GLOBAL_ENTITY_ID = GlobalEntityIdSchema.parse("HF_EG");

export function getDefaultGlobalEntityId() {
  return DEFAULT_GLOBAL_ENTITY_ID;
}

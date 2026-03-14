import { z } from "zod";
export const GlobalEntityIdSchema = z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9_-]+$/);
export function resolveBootstrapGlobalEntityId(env) {
    const value = env.UPUSE_BOOTSTRAP_GLOBAL_ENTITY_ID?.trim();
    if (!value) {
        throw new Error("UPUSE_BOOTSTRAP_GLOBAL_ENTITY_ID must be set when initializing the settings row for the first time.");
    }
    const parsed = GlobalEntityIdSchema.safeParse(value);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(`UPUSE_BOOTSTRAP_GLOBAL_ENTITY_ID is invalid: ${issue?.message ?? "invalid value"}`);
    }
    return parsed.data;
}

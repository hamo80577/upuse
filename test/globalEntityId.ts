import { GlobalEntityIdSchema } from "../apps/server/src/config/globalEntityId";

export const TEST_GLOBAL_ENTITY_ID = GlobalEntityIdSchema.parse("TEST_ENTITY_PRIMARY");
export const TEST_GLOBAL_ENTITY_ID_VARIANT = GlobalEntityIdSchema.parse("TEST_ENTITY_SECONDARY");

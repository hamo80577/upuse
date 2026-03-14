import { describe, expect, it } from "vitest";
import { resolveBootstrapGlobalEntityId } from "./globalEntityId.js";
import { TEST_GLOBAL_ENTITY_ID_VARIANT } from "../../../../test/globalEntityId";

describe("globalEntityId bootstrap configuration", () => {
  it("requires an explicit bootstrap entity when the settings row is first created", () => {
    expect(() => resolveBootstrapGlobalEntityId({} as NodeJS.ProcessEnv)).toThrow(
      /UPUSE_BOOTSTRAP_GLOBAL_ENTITY_ID must be set/i,
    );
  });

  it("accepts only valid persisted global entity ids", () => {
    expect(resolveBootstrapGlobalEntityId({
      UPUSE_BOOTSTRAP_GLOBAL_ENTITY_ID: TEST_GLOBAL_ENTITY_ID_VARIANT,
    } as NodeJS.ProcessEnv)).toBe(TEST_GLOBAL_ENTITY_ID_VARIANT);

    expect(() => resolveBootstrapGlobalEntityId({
      UPUSE_BOOTSTRAP_GLOBAL_ENTITY_ID: "  ",
    } as NodeJS.ProcessEnv)).toThrow(/UPUSE_BOOTSTRAP_GLOBAL_ENTITY_ID/i);
  });
});

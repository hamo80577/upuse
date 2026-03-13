import { describe, expect, it } from "vitest";
import { GlobalEntityIdSchema, getDefaultGlobalEntityId } from "./globalEntityId.js";

describe("globalEntityId bootstrap configuration", () => {
  it("uses one fixed project-wide default for the initial settings row", () => {
    expect(getDefaultGlobalEntityId()).toBe(GlobalEntityIdSchema.parse(getDefaultGlobalEntityId()));
  });

  it("returns a valid persisted global entity id", () => {
    expect(() => getDefaultGlobalEntityId()).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { describeLogMessage } from "./logMessageMapper";

describe("describeLogMessage", () => {
  it("explains capacity-based temporary closures", () => {
    expect(describeLogMessage("TEMP CLOSE — Capacity active=10 cap=9 recentActivePickers=3 until 15:40")).toEqual({
      title: "Temporary close applied",
      detail: "Active orders reached 10, above picker capacity 9 from 3 recent active pickers (30m). Source timer ends at 15:40.",
    });
  });

  it("explains capacity closures re-applied after grace", () => {
    expect(
      describeLogMessage("TEMP CLOSE — re-applied after external open grace (Capacity active=10 cap=9 recentActivePickers=3) until 15:40"),
    ).toEqual({
      title: "Temporary close re-applied",
      detail: "Active orders stayed at 10 above picker capacity 9 from 3 recent active pickers (30m) after grace. Source timer ends at 15:40.",
    });
  });
});

import { describe, expect, it } from "vitest";
import { describeLogMessage } from "./logMessageMapper";

describe("describeLogMessage", () => {
  it("explains capacity-based temporary closures", () => {
    expect(describeLogMessage("TEMP CLOSE — Capacity active=10 cap=6 pickers=3 until 15:40")).toEqual({
      title: "Temporary close applied",
      detail: "Active orders reached 10, above picker capacity 6 from 3 last-hour pickers. Source timer ends at 15:40.",
    });
  });

  it("explains capacity closures re-applied after grace", () => {
    expect(
      describeLogMessage("TEMP CLOSE — re-applied after external open grace (Capacity active=10 cap=6 pickers=3) until 15:40"),
    ).toEqual({
      title: "Temporary close re-applied",
      detail: "Active orders stayed at 10 above picker capacity 6 from 3 last-hour pickers after grace. Source timer ends at 15:40.",
    });
  });
});

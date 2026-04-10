import { describe, expect, it } from "vitest";
import { describeLogMessage } from "./logMessageMapper";

describe("describeLogMessage", () => {
  it("explains legacy capacity-based temporary closures", () => {
    expect(describeLogMessage("TEMP CLOSE — Capacity active=10 cap=9 recentActivePickers=3 until 15:40")).toEqual({
      title: "Temporary close applied",
      detail: "Active orders reached 10, above picker capacity 9 from 3 recent active pickers (60m). Source timer ends at 15:40.",
    });
  });

  it("explains new in-prep capacity-based temporary closures", () => {
    expect(describeLogMessage("TEMP CLOSE — Capacity inPrep=10 cap=9 recentActivePickers=3 until 15:40")).toEqual({
      title: "Temporary close applied",
      detail: "In Prep orders reached 10, above picker capacity 9 from 3 recent active pickers (60m). Source timer ends at 15:40.",
    });
  });

  it("explains legacy capacity closures re-applied after grace", () => {
    expect(
      describeLogMessage("TEMP CLOSE — re-applied after external open grace (Capacity active=10 cap=9 recentActivePickers=3) until 15:40"),
    ).toEqual({
      title: "Temporary close re-applied",
      detail: "Active orders stayed at 10 above picker capacity 9 from 3 recent active pickers (60m) after grace. Source timer ends at 15:40.",
    });
  });

  it("explains new in-prep capacity closures re-applied after grace", () => {
    expect(
      describeLogMessage("TEMP CLOSE — re-applied after external open grace (Capacity inPrep=10 cap=9 recentActivePickers=3) until 15:40"),
    ).toEqual({
      title: "Temporary close re-applied",
      detail: "In Prep orders stayed at 10 above picker capacity 9 from 3 recent active pickers (60m) after grace. Source timer ends at 15:40.",
    });
  });

  it("explains ready to pickup temporary closures", () => {
    expect(describeLogMessage("TEMP CLOSE — Ready To Pickup=4 until 15:40")).toEqual({
      title: "Temporary close applied",
      detail: "Ready To Pickup reached 4. Source timer ends at 15:40.",
    });
  });

  it("explains ready to pickup closures re-applied after grace", () => {
    expect(
      describeLogMessage("TEMP CLOSE — re-applied after external open grace (Ready To Pickup=4) until 15:40"),
    ).toEqual({
      title: "Temporary close re-applied",
      detail: "Ready To Pickup stayed at 4 after grace. Source timer ends at 15:40.",
    });
  });
});

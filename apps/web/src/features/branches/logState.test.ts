import { describe, expect, it } from "vitest";
import { appendOlderLogDayUnique, upsertLatestLogDay, type BranchLogDay } from "./logState";

const day = (dayKey: string, message: string): BranchLogDay => ({
  dayKey,
  dayLabel: dayKey,
  items: [{ ts: `${dayKey}T10:00:00.000Z`, level: "INFO", message }],
});

describe("branch log state helpers", () => {
  it("upserts latest day for refresh without duplicating day keys", () => {
    const current = [day("2026-03-05", "old"), day("2026-03-04", "older")];
    const update = upsertLatestLogDay({
      current,
      initialLoad: false,
      page: {
        dayKey: "2026-03-05",
        dayLabel: "2026-03-05",
        items: [{ ts: "2026-03-05T11:00:00.000Z", level: "INFO", message: "new" }],
        hasMore: true,
      },
    });

    expect(update.next).toHaveLength(2);
    expect(update.next[0]?.items[0]?.message).toBe("new");
    expect(update.hasMore).toBe(true);
  });

  it("appends older day once and skips duplicates", () => {
    const current = [day("2026-03-05", "today")];
    const first = appendOlderLogDayUnique({
      current,
      page: {
        dayKey: "2026-03-04",
        dayLabel: "2026-03-04",
        items: [{ ts: "2026-03-04T11:00:00.000Z", level: "WARN", message: "older" }],
        hasMore: false,
      },
    });

    const second = appendOlderLogDayUnique({
      current: first.next,
      page: {
        dayKey: "2026-03-04",
        dayLabel: "2026-03-04",
        items: [{ ts: "2026-03-04T11:00:00.000Z", level: "WARN", message: "older" }],
        hasMore: false,
      },
    });

    expect(first.next).toHaveLength(2);
    expect(second.next).toHaveLength(2);
    expect(second.hasMore).toBe(false);
  });
});

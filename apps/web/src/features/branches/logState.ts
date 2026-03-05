export interface BranchLogDay {
  dayKey: string;
  dayLabel: string;
  items: Array<{ ts: string; level: string; message: string }>;
}

export interface BranchLogPage {
  dayKey: string | null;
  dayLabel: string | null;
  items: Array<{ ts: string; level: string; message: string }>;
  hasMore: boolean;
}

export function upsertLatestLogDay(params: {
  current: BranchLogDay[];
  page: BranchLogPage;
  initialLoad: boolean;
}) {
  if (!params.page.dayKey || !params.page.dayLabel) {
    return {
      next: [] as BranchLogDay[],
      hasMore: false,
    };
  }

  const nextFirstDay = {
    dayKey: params.page.dayKey,
    dayLabel: params.page.dayLabel,
    items: params.page.items,
  };

  if (params.initialLoad || !params.current.length) {
    return {
      next: [nextFirstDay],
      hasMore: params.page.hasMore,
    };
  }

  if (params.current[0].dayKey === params.page.dayKey) {
    return {
      next: [nextFirstDay, ...params.current.slice(1)],
      hasMore: params.page.hasMore,
    };
  }

  return {
    next: [nextFirstDay, ...params.current.filter((group) => group.dayKey !== params.page.dayKey)],
    hasMore: params.page.hasMore,
  };
}

export function appendOlderLogDayUnique(params: {
  current: BranchLogDay[];
  page: BranchLogPage;
}) {
  if (!params.page.dayKey || !params.page.dayLabel) {
    return {
      next: params.current,
      hasMore: false,
    };
  }

  if (params.current.some((group) => group.dayKey === params.page.dayKey)) {
    return {
      next: params.current,
      hasMore: params.page.hasMore,
    };
  }

  return {
    next: [
      ...params.current,
      {
        dayKey: params.page.dayKey,
        dayLabel: params.page.dayLabel,
        items: params.page.items,
      },
    ],
    hasMore: params.page.hasMore,
  };
}

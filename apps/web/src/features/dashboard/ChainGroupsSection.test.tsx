import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/BranchCard", () => ({
  BranchCard: ({ b }: { b: { name: string } }) => <div>{b.name}</div>,
}));

import { ChainGroupsSection } from "./ChainGroupsSection";

describe("ChainGroupsSection", () => {
  it("keeps groups collapsed by default and expands only after click", () => {
    render(
      <ChainGroupsSection
        groups={[
          {
            key: "chain:carrefour",
            label: "Carrefour",
            totals: { open: 1, tempClose: 0, closed: 0, unknown: 0 },
            items: [
              {
                rank: 1,
                branch: {
                  branchId: 1,
                  name: "Carrefour, Madinaty",
                  chainName: "Carrefour",
                  monitorEnabled: true,
                  ordersVendorId: 100,
                  availabilityVendorId: "200",
                  status: "OPEN",
                  statusColor: "green",
                  metrics: {
                    totalToday: 10,
                    cancelledToday: 0,
                    doneToday: 4,
                    activeNow: 2,
                    lateNow: 0,
                    unassignedNow: 1,
                  },
                  preparingNow: 1,
                  preparingPickersNow: 1,
                  lastUpdatedAt: "2026-03-11T10:00:00.000Z",
                },
              },
            ],
          },
        ]}
        expandedGroups={{}}
        onToggleGroup={vi.fn()}
        onOpenBranchDetail={vi.fn()}
        ordersSyncState="fresh"
      />,
    );

    expect(screen.queryByText("Carrefour, Madinaty")).not.toBeInTheDocument();
  });

  it("shows branches after toggling the group open", () => {
    function Example() {
      const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

      return (
        <ChainGroupsSection
          groups={[
            {
              key: "chain:carrefour",
              label: "Carrefour",
              totals: { open: 1, tempClose: 0, closed: 0, unknown: 0 },
              items: [
                {
                  rank: 1,
                  branch: {
                    branchId: 1,
                    name: "Carrefour, Madinaty",
                    chainName: "Carrefour",
                    monitorEnabled: true,
                    ordersVendorId: 100,
                    availabilityVendorId: "200",
                    status: "OPEN",
                    statusColor: "green",
                    metrics: {
                      totalToday: 10,
                      cancelledToday: 0,
                      doneToday: 4,
                      activeNow: 2,
                      lateNow: 0,
                      unassignedNow: 1,
                    },
                    preparingNow: 1,
                    preparingPickersNow: 1,
                    lastUpdatedAt: "2026-03-11T10:00:00.000Z",
                  },
                },
              ],
            },
          ]}
          expandedGroups={expandedGroups}
          onToggleGroup={(groupKey) => setExpandedGroups((current) => ({ ...current, [groupKey]: !(current[groupKey] ?? false) }))}
          onOpenBranchDetail={vi.fn()}
          ordersSyncState="fresh"
        />
      );
    }

    render(<Example />);

    fireEvent.click(screen.getByRole("button", { name: /Carrefour/i }));

    expect(screen.getByText("Carrefour, Madinaty")).toBeInTheDocument();
  });
});

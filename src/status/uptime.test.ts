import { describe, expect, it } from "vitest";
import { calculateUptime, expectedSlotsForDay } from "./uptime";

describe("uptime calculations", () => {
  it("calculates uptime and coverage independently", () => {
    expect(
      calculateUptime({ upSamples: 8, downSamples: 2, expectedSamples: 12 }),
    ).toEqual({
      observedSamples: 10,
      uptimePercent: 80,
      coveragePercent: 83.3333,
    });
  });

  it("does not turn no observations into zero uptime", () => {
    expect(
      calculateUptime({ upSamples: 0, downSamples: 0, expectedSamples: 12 }),
    ).toEqual({
      observedSamples: 0,
      uptimePercent: null,
      coveragePercent: 0,
    });
  });

  it("counts missing slots against coverage only", () => {
    const result = calculateUptime({
      upSamples: 2,
      downSamples: 0,
      expectedSamples: 4,
    });

    expect(result.uptimePercent).toBe(100);
    expect(result.coveragePercent).toBe(50);
  });

  it.each([
    { upSamples: -1, downSamples: 1, expectedSamples: 1 },
    { upSamples: 1, downSamples: -1, expectedSamples: 1 },
    { upSamples: 1, downSamples: 1, expectedSamples: -1 },
    { upSamples: 2, downSamples: 1, expectedSamples: 2 },
  ])("rejects invalid counts: $upSamples/$downSamples/$expectedSamples", (input) => {
    expect(() => calculateUptime(input)).toThrow();
  });
});

describe("expected five-minute slots", () => {
  it("counts 288 slots on a complete UTC day", () => {
    expect(
      expectedSlotsForDay({
        day: "2026-08-08",
        monitoringStartedAt: "2026-08-07T00:00:00Z",
        now: new Date("2026-08-09T00:00:00Z"),
      }),
    ).toBe(288);
  });

  it("starts a launch day at its first scheduled observed slot", () => {
    expect(
      expectedSlotsForDay({
        day: "2026-08-09",
        monitoringStartedAt: "2026-08-09T09:03:00Z",
        now: new Date("2026-08-10T00:00:00Z"),
      }),
    ).toBe(180);
  });

  it("counts only elapsed slots for the current UTC day", () => {
    expect(
      expectedSlotsForDay({
        day: "2026-08-09",
        monitoringStartedAt: "2026-08-08T00:00:00Z",
        now: new Date("2026-08-09T00:20:00Z"),
      }),
    ).toBe(4);
  });
});

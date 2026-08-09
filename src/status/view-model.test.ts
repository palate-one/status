import { describe, expect, it } from "vitest";

import type { PublicStatusResponse } from "../../worker/read";
import {
  buildThirtyDayUptimeRail,
  formatUptime,
  groupResolvedHistory,
  sortIncidentHistory,
  sortIncidents,
  sortMaintenanceHistory,
  sortMaintenance,
  toStatusViewModel,
} from "./view-model";

const NOW = new Date("2026-08-09T12:20:00Z");

function response(overrides: Partial<PublicStatusResponse> = {}): PublicStatusResponse {
  return {
    generatedAt: "2026-08-09T12:18:00Z",
    monitoringStartedAt: "2026-08-01T00:03:00Z",
    overall: "operational",
    components: [
      {
        id: "web",
        label: "Web",
        status: "operational",
        lastCheckedAt: "2026-08-09T12:17:00Z",
        lastSuccessAt: "2026-08-09T12:17:00Z",
        uptime30d: 99.5,
        coverage30d: 98.125,
        days: [],
      },
      {
        id: "api",
        label: "API",
        status: "operational",
        lastCheckedAt: "2026-08-09T12:16:00Z",
        lastSuccessAt: "2026-08-09T12:16:00Z",
        uptime30d: 100,
        coverage30d: 100,
        days: [],
      },
    ],
    ...overrides,
  };
}

describe("status view model", () => {
  it("projects observations onto a fixed UTC 30-day rail", () => {
    const rail = buildThirtyDayUptimeRail(
      [
        {
          day: "2026-08-08",
          upSamples: 280,
          downSamples: 8,
          expectedSamples: 288,
          uptimePercent: 97.22,
          coveragePercent: 100,
        },
        {
          day: "2026-08-09",
          upSamples: 12,
          downSamples: 0,
          expectedSamples: 12,
          uptimePercent: 100,
          coveragePercent: 4.17,
        },
      ],
      NOW,
    );

    expect(rail).toHaveLength(30);
    expect(rail[0].day).toBe("2026-07-11");
    expect(rail.at(-1)?.day).toBe("2026-08-09");
    expect(rail[0]).toMatchObject({
      uptimePercent: null,
      expectedSamples: 0,
      coveragePercent: 0,
    });
    expect(rail[0].ariaLabel).toContain("가동률 측정 데이터 없음");
    expect(rail.at(-2)).toMatchObject({
      day: "2026-08-08",
      uptimePercent: 97.22,
      upSamples: 280,
      downSamples: 8,
    });
  });

  it("uses the fixed rail for every component", () => {
    const model = toStatusViewModel(
      response({
        components: response().components.map((component) => ({
          ...component,
          days: [
            {
              day: "2026-08-09",
              upSamples: 1,
              downSamples: 0,
              expectedSamples: 1,
              uptimePercent: 100,
              coveragePercent: 100,
            },
          ],
        })),
      }),
      NOW,
    );

    expect(model.components.map(({ days }) => days.length)).toEqual([30, 30]);
    expect(model.components.every(({ days }) => days.at(-1)?.day === "2026-08-09")).toBe(true);
  });

  it("keeps received samples when the projection time is invalid", () => {
    const [sample] = buildThirtyDayUptimeRail(
      [
        {
          day: "2026-08-09",
          upSamples: 1,
          downSamples: 0,
          expectedSamples: 1,
          uptimePercent: 100,
          coveragePercent: 100,
        },
      ],
      new Date(Number.NaN),
    );

    expect(sample).toMatchObject({ day: "2026-08-09", uptimeLabel: "100%" });
  });

  it("maps public states to Korean labels and readable percentages", () => {
    const model = toStatusViewModel(response(), NOW);

    expect(model.overallLabel).toBe("모든 시스템 정상");
    expect(model.components[0]).toMatchObject({
      label: "Web",
      statusLabel: "정상",
      uptimeLabel: "99.5%",
      coverageLabel: "98.13%",
    });
    expect(formatUptime(null)).toBe("측정 데이터 없음");
    expect(formatUptime(100)).toBe("100%");
  });

  it("does not invent a healthy state when no observations exist", () => {
    const model = toStatusViewModel(
      response({
        monitoringStartedAt: null,
        overall: "operational",
        components: [
          {
            id: "web",
            label: "Web",
            status: "operational",
            lastCheckedAt: null,
            lastSuccessAt: null,
            uptime30d: null,
            coverage30d: 0,
            days: [],
          },
          {
            id: "api",
            label: "API",
            status: "operational",
            lastCheckedAt: null,
            lastSuccessAt: null,
            uptime30d: null,
            coverage30d: 0,
            days: [],
          },
        ],
      }),
      NOW,
    );

    expect(model.overallLabel).toBe("상태 확인 불가");
    expect(model.components.map(({ statusLabel, uptimeLabel }) => [statusLabel, uptimeLabel])).toEqual([
      ["상태 확인 불가", "측정 데이터 없음"],
      ["상태 확인 불가", "측정 데이터 없음"],
    ]);
  });

  it("keeps outage precedence when another component is unknown", () => {
    const base = response();
    const model = toStatusViewModel(
      response({
        overall: "service_disruption",
        components: [
          { ...base.components[0], status: "outage" },
          { ...base.components[1], status: "unknown" },
        ],
      }),
      NOW,
    );

    expect(model.overallStatus).toBe("service_disruption");
    expect(model.overallLabel).toBe("서비스 문제 발생");
  });

  it("turns an older API response into an unknown state on the client", () => {
    const model = toStatusViewModel(
      response({ generatedAt: "2026-08-09T11:59:59Z" }),
      NOW,
    );

    expect(model.isStale).toBe(true);
    expect(model.overallLabel).toBe("상태 확인 불가");
    expect(model.components.every(({ statusLabel }) => statusLabel === "상태 확인 불가")).toBe(true);
  });

  it("orders active incidents newest first and maintenance by start time", () => {
    const incidents = [
      { data: { id: "inc-old", status: "investigating", startedAt: "2026-08-08T04:00:00Z" } },
      { data: { id: "inc-new", status: "monitoring", startedAt: "2026-08-09T04:00:00Z" } },
      { data: { id: "inc-resolved", status: "resolved", startedAt: "2026-08-07T04:00:00Z" } },
    ] as const;
    const maintenance = [
      { data: { id: "maint-late", status: "scheduled", startsAt: "2026-08-10T04:00:00Z" } },
      { data: { id: "maint-now", status: "in_progress", startsAt: "2026-08-09T04:00:00Z" } },
      { data: { id: "maint-done", status: "completed", startsAt: "2026-08-01T04:00:00Z", endsAt: "2026-08-01T05:00:00Z" } },
    ] as const;

    expect(sortIncidents(incidents).map(({ data }) => data.id)).toEqual([
      "inc-new",
      "inc-old",
      "inc-resolved",
    ]);
    expect(sortMaintenance(maintenance).map(({ data }) => data.id)).toEqual([
      "maint-now",
      "maint-late",
      "maint-done",
    ]);
  });

  it("orders resolved and completed history newest first", () => {
    const incidents = [
      {
        data: {
          id: "inc-old",
          status: "resolved",
          startedAt: "2026-08-08T04:00:00Z",
          resolvedAt: "2026-08-08T05:00:00Z",
        },
      },
      {
        data: {
          id: "inc-new",
          status: "resolved",
          startedAt: "2026-08-09T04:00:00Z",
          resolvedAt: "2026-08-09T05:00:00Z",
        },
      },
    ] as const;
    const maintenance = [
      {
        data: {
          id: "maint-old",
          status: "completed",
          startsAt: "2026-08-08T04:00:00Z",
          endsAt: "2026-08-08T05:00:00Z",
        },
      },
      {
        data: {
          id: "maint-new",
          status: "completed",
          startsAt: "2026-08-09T04:00:00Z",
          endsAt: "2026-08-09T05:00:00Z",
        },
      },
    ] as const;

    expect(sortIncidentHistory(incidents).map(({ data }) => data.id)).toEqual([
      "inc-new",
      "inc-old",
    ]);
    expect(sortMaintenanceHistory(maintenance).map(({ data }) => data.id)).toEqual([
      "maint-new",
      "maint-old",
    ]);
  });

  it("groups resolved history by KST completion date and keeps newest completion first", () => {
    const incidents = [
      {
        data: {
          id: "inc-2026-08-08-kst-history",
          status: "resolved",
          startedAt: "2026-08-08T23:00:00Z",
          resolvedAt: "2026-08-09T00:30:00Z",
        },
      },
    ] as const;
    const maintenance = [
      {
        data: {
          id: "maint-2026-08-08-kst-history",
          status: "completed",
          startsAt: "2026-08-08T23:30:00Z",
          endsAt: "2026-08-09T01:00:00Z",
        },
      },
    ] as const;

    const groups = groupResolvedHistory(incidents, maintenance);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.date).toBe("2026-08-09");
    expect(groups[0]?.entries.map(({ kind }) => kind)).toEqual([
      "maintenance",
      "incident",
    ]);
    expect(groups[0]?.entries.map(({ entry }) => entry.data.id)).toEqual([
      "maint-2026-08-08-kst-history",
      "inc-2026-08-08-kst-history",
    ]);
  });
});

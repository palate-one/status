import { describe, expect, it } from "vitest";

import type { PublicStatusResponse } from "../../worker/read";
import {
  formatUptime,
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
});

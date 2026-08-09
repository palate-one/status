import { describe, expect, it } from "vitest";

import {
  incidentSchema,
  maintenanceSchema,
  weeklyFilenameMatchesWeek,
  weeklyUptimeSchema,
} from "./content-schema";

const validIncident = {
  id: "inc-2026-08-09-api",
  title: "API 응답 지연",
  status: "monitoring" as const,
  severity: "degraded" as const,
  components: ["api" as const],
  startedAt: "2026-08-09T02:00:00Z",
  resolvedAt: null,
};

const validMaintenance = {
  id: "maint-2026-08-09-api",
  title: "API 배포",
  status: "scheduled" as const,
  components: ["api" as const],
  startsAt: "2026-08-10T02:00:00Z",
  endsAt: "2026-08-10T03:00:00Z",
};

const validWeeklyUptime = {
  schemaVersion: 1 as const,
  week: "2026-W32",
  from: "2026-08-03T00:00:00Z",
  to: "2026-08-10T00:00:00Z",
  generatedAt: "2026-08-10T00:05:00Z",
  monitoringStartedAt: "2026-08-01T00:00:00Z",
  components: [
    {
      id: "web" as const,
      upSamples: 288,
      downSamples: 0,
      expectedSamples: 288,
      uptimePercent: 100,
      coveragePercent: 100,
    },
  ],
};

describe("public status content schemas", () => {
  it("rejects components outside the public allowlist", () => {
    expect(() => incidentSchema.parse({ ...validIncident, components: ["database"] })).toThrow();
    expect(() => maintenanceSchema.parse({ ...validMaintenance, components: ["database"] })).toThrow();
    expect(() => weeklyUptimeSchema.parse({
      ...validWeeklyUptime,
      components: [{ ...validWeeklyUptime.components[0], id: "database" }],
    })).toThrow();
  });

  it("rejects timestamps that are not valid RFC 3339 values", () => {
    expect(() => incidentSchema.parse({ ...validIncident, startedAt: "2026-08-09 02:00:00" })).toThrow();
    expect(() => maintenanceSchema.parse({ ...validMaintenance, endsAt: "2026-02-30T03:00:00Z" })).toThrow();
    expect(() => weeklyUptimeSchema.parse({ ...validWeeklyUptime, generatedAt: "2026-08-10" })).toThrow();
  });

  it("requires at least one component", () => {
    expect(() => incidentSchema.parse({ ...validIncident, components: [] })).toThrow();
    expect(() => maintenanceSchema.parse({ ...validMaintenance, components: [] })).toThrow();
    expect(() => weeklyUptimeSchema.parse({ ...validWeeklyUptime, components: [] })).toThrow();
  });

  it("requires resolved incidents to include resolvedAt", () => {
    expect(() => incidentSchema.parse({
      ...validIncident,
      status: "resolved",
      resolvedAt: null,
    })).toThrow();
  });

  it("keeps unresolved incidents from carrying a resolvedAt timestamp", () => {
    expect(() => incidentSchema.parse({
      ...validIncident,
      status: "monitoring",
      resolvedAt: "2026-08-09T03:00:00Z",
    })).toThrow();
  });

  it("requires maintenance to end after it starts", () => {
    expect(() => maintenanceSchema.parse({
      ...validMaintenance,
      endsAt: "2026-08-10T02:00:00Z",
    })).toThrow();
    expect(() => maintenanceSchema.parse({
      ...validMaintenance,
      endsAt: "2026-08-10T01:00:00Z",
    })).toThrow();
  });

  it("requires a completed maintenance entry to have an end time", () => {
    expect(() => maintenanceSchema.parse({
      ...validMaintenance,
      status: "completed",
      endsAt: null,
    })).toThrow();
  });

  it("requires the weekly uptime filename and week to agree", () => {
    expect(weeklyFilenameMatchesWeek("2026-W32.json", validWeeklyUptime.week)).toBe(true);
    expect(weeklyFilenameMatchesWeek("2026-W33.json", validWeeklyUptime.week)).toBe(false);
  });
});

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import type { CheckSample, ComponentId } from "../src/status/types";
import { createD1StatusStore } from "./store";

const store = createD1StatusStore(env.TEST_DB);

function sample(
  component: ComponentId,
  scheduledAt: string,
  result: "up" | "down",
): CheckSample {
  return {
    component,
    scheduledAt,
    checkedAt: scheduledAt,
    result,
    latencyMs: 123,
    httpStatus: result === "up" ? 200 : 503,
    failureCode: result === "up" ? null : "http_status",
  };
}

async function resetDatabase(): Promise<void> {
  await env.TEST_DB.batch([
    env.TEST_DB.prepare("DELETE FROM check_samples"),
    env.TEST_DB.prepare("DELETE FROM daily_uptime"),
    env.TEST_DB.prepare(`
      UPDATE component_state
      SET status = 'unknown',
          consecutive_failures = 0,
          last_checked_at = NULL,
          last_success_at = NULL,
          last_failure_at = NULL
    `),
    env.TEST_DB.prepare(`
      UPDATE status_metadata
      SET monitoring_started_at = NULL,
          latest_day = NULL,
          states_json = (
            SELECT json_group_array(json_object(
              'component', component,
              'status', status,
              'consecutive_failures', consecutive_failures,
              'last_checked_at', last_checked_at,
              'last_success_at', last_success_at,
              'last_failure_at', last_failure_at
            ))
            FROM (SELECT * FROM component_state ORDER BY component)
          ),
          daily_json = '[]'
      WHERE id = 1
    `),
  ]);
}

beforeEach(resetDatabase);

describe("D1 status store", () => {
  it("seeds both public components as unknown", async () => {
    const snapshot = await store.readStatus(new Date("2026-08-09T00:03:00Z"));

    expect(snapshot.states).toEqual([
      {
        component: "api",
        status: "unknown",
        consecutiveFailures: 0,
        lastCheckedAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      },
      {
        component: "web",
        status: "unknown",
        consecutiveFailures: 0,
        lastCheckedAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      },
    ]);
    expect(snapshot.monitoringStartedAt).toBeNull();
    expect(snapshot.daily).toEqual([]);
  });

  it.each([
    ["component", "media", "up"],
    ["result", "web", "flaky"],
  ])("rejects an invalid %s at the SQL boundary", async (_field, component, result) => {
    await expect(
      env.TEST_DB.prepare(`
        INSERT INTO check_samples (
          component, scheduled_at, checked_at, result, latency_ms, http_status, failure_code
        ) VALUES (?1, ?2, ?3, ?4, 100, 200, NULL)
      `)
        .bind(component, "2026-08-09T00:03:00Z", "2026-08-09T00:03:00Z", result)
        .run(),
    ).rejects.toThrow();
  });

  it("inserts each component and slot once without replaying state", async () => {
    const first = await store.insertSamples([
      sample("web", "2026-08-09T00:03:00Z", "down"),
    ]);
    const replay = await store.insertSamples([
      sample("web", "2026-08-09T00:03:00Z", "down"),
    ]);
    const snapshot = await store.readStatus(new Date("2026-08-09T00:03:00Z"));

    expect(first).toEqual({ inserted: 1 });
    expect(replay).toEqual({ inserted: 0 });
    expect(snapshot.states.find((state) => state.component === "web")).toMatchObject({
      status: "unknown",
      consecutiveFailures: 1,
    });
    expect(snapshot.daily).toEqual([
      expect.objectContaining({
        component: "web",
        day: "2026-08-09",
        upSamples: 0,
        downSamples: 1,
      }),
    ]);
  });

  it("applies the failure, outage, and recovery transition table", async () => {
    const cases = [
      ["2026-08-09T00:03:00Z", "down", "unknown", 1],
      ["2026-08-09T00:08:00Z", "down", "outage", 2],
      ["2026-08-09T00:13:00Z", "up", "operational", 0],
    ] as const;

    for (const [scheduledAt, result, expectedStatus, expectedFailures] of cases) {
      await store.insertSamples([sample("api", scheduledAt, result)]);
      const snapshot = await store.readStatus(new Date(scheduledAt));
      expect(snapshot.states.find((state) => state.component === "api")).toMatchObject({
        status: expectedStatus,
        consecutiveFailures: expectedFailures,
      });
    }
  });

  it.each([
    ["keeps history at exactly 15 minutes", "2026-08-09T00:18:00Z", "outage", 2],
    ["resets history one second after 15 minutes", "2026-08-09T00:18:01Z", "unknown", 1],
  ])("%s", async (_case, checkedAt, expectedStatus, expectedFailures) => {
    await store.insertSamples([sample("api", "2026-08-09T00:03:00Z", "down")]);
    await store.insertSamples([{
      ...sample("api", "2026-08-09T00:18:00Z", "down"),
      checkedAt,
    }]);

    const snapshot = await store.readStatus(new Date(checkedAt));
    expect(snapshot.states.find((state) => state.component === "api")).toMatchObject({
      status: expectedStatus,
      consecutiveFailures: expectedFailures,
    });
  });

  it.each([
    ["fractional seconds", "2026-08-09T00:03:00.100Z"],
    ["Julian timestamp text", "2461192.50208333"],
    ["space-separated UTC", "2026-08-09 00:03:00"],
    ["explicit UTC offset", "2026-08-09T00:03:00+00:00"],
  ])("rejects noncanonical checked_at %s", async (_case, checkedAt) => {
    await expect(
      store.insertSamples([{
        ...sample("web", "2026-08-09T00:03:00Z", "up"),
        checkedAt,
      }]),
    ).rejects.toThrow();
  });

  it("does not let a late sample roll current state backward", async () => {
    await store.insertSamples([sample("web", "2026-08-09T00:08:00Z", "up")]);
    await store.insertSamples([sample("web", "2026-08-09T00:03:00Z", "down")]);

    const snapshot = await store.readStatus(new Date("2026-08-09T00:08:00Z"));
    expect(snapshot.states.find((state) => state.component === "web")).toMatchObject({
      status: "operational",
      consecutiveFailures: 0,
      lastCheckedAt: "2026-08-09T00:08:00Z",
    });
    expect(snapshot.daily[0]).toMatchObject({ upSamples: 1, downSamples: 1 });
  });

  it("increments exactly one aggregate counter per accepted sample", async () => {
    await store.insertSamples([sample("web", "2026-08-09T00:03:00Z", "up")]);
    await store.insertSamples([sample("web", "2026-08-09T00:08:00Z", "down")]);

    const snapshot = await store.readStatus(new Date("2026-08-09T00:08:00Z"));
    expect(snapshot.daily).toEqual([
      expect.objectContaining({
        upSamples: 1,
        downSamples: 1,
        storedExpectedSamples: 2,
        firstScheduledAt: "2026-08-09T00:03:00Z",
        lastScheduledAt: "2026-08-09T00:08:00Z",
      }),
    ]);
  });

  it("deletes only expired samples and respects the batch limit", async () => {
    await store.insertSamples([sample("web", "2026-06-01T00:03:00Z", "up")]);
    await store.insertSamples([sample("api", "2026-06-01T00:03:00Z", "up")]);
    await store.insertSamples([sample("web", "2026-08-09T00:03:00Z", "up")]);

    expect(
      await store.deleteExpiredSamples(new Date("2026-07-05T00:00:00Z"), 1),
    ).toBe(1);

    const rows = await env.TEST_DB.prepare(
      "SELECT component, scheduled_at FROM check_samples ORDER BY component, scheduled_at",
    ).all();
    expect(rows.results).toHaveLength(2);
    expect(rows.results).toContainEqual({
      component: "web",
      scheduled_at: "2026-08-09T00:03:00Z",
    });
  });

  it("reads at most 30 UTC days of aggregates while preserving the original start", async () => {
    await store.insertSamples([sample("web", "2026-06-01T00:03:00Z", "up")]);
    await store.insertSamples([sample("web", "2026-07-10T00:03:00Z", "up")]);
    await store.insertSamples([sample("web", "2026-07-11T00:03:00Z", "up")]);
    await store.insertSamples([sample("web", "2026-08-09T00:03:00Z", "up")]);

    const result = await store.readStatus(new Date("2026-08-09T12:00:00Z"));

    expect(result.monitoringStartedAt).toBe("2026-06-01T00:03:00Z");
    expect(result.daily.map(({ day }) => day)).toEqual(["2026-07-11", "2026-08-09"]);
  });

  it("reads monitoring start from bounded singleton metadata", async () => {
    await store.insertSamples([sample("web", "2026-06-01T00:03:00Z", "up")]);
    await env.TEST_DB.prepare("DELETE FROM daily_uptime").run();

    const result = await store.readStatus(new Date("2026-08-09T12:00:00Z"));
    const metadata = await env.TEST_DB.prepare(
      "SELECT monitoring_started_at FROM status_metadata WHERE id = 1",
    ).first<{ monitoring_started_at: string | null }>();

    expect(result.monitoringStartedAt).toBe("2026-06-01T00:03:00Z");
    expect(metadata?.monitoring_started_at).toBe("2026-06-01T00:03:00Z");
  });

  it("serves public state from one materialized metadata row", async () => {
    await store.insertSamples([sample("web", "2026-08-09T00:03:00Z", "up")]);
    await env.TEST_DB.batch([
      env.TEST_DB.prepare("DELETE FROM daily_uptime"),
      env.TEST_DB.prepare(`
        UPDATE component_state
        SET status = 'unknown',
            consecutive_failures = 0,
            last_checked_at = NULL,
            last_success_at = NULL,
            last_failure_at = NULL
      `),
    ]);

    const result = await store.readStatus(new Date("2026-08-09T12:00:00Z"));

    expect(result.states.find(({ component }) => component === "web")).toMatchObject({
      status: "operational",
      lastCheckedAt: "2026-08-09T00:03:00Z",
    });
    expect(result.daily).toEqual([
      expect.objectContaining({ component: "web", day: "2026-08-09", upSamples: 1 }),
    ]);
  });

  it("uses the checked-at retention index without a full scan or sort", async () => {
    const plan = await env.TEST_DB.prepare(`
      EXPLAIN QUERY PLAN
      SELECT id
      FROM check_samples
      WHERE checked_at < ?1
      ORDER BY checked_at, id
      LIMIT ?2
    `)
      .bind("2026-08-01T00:00:00Z", 1_000)
      .all<{ detail: string }>();
    const details = plan.results.map(({ detail }) => detail).join("\n");

    expect(details).toContain("check_samples_checked_at_id_idx");
    expect(details).not.toContain("SCAN check_samples");
    expect(details).not.toContain("TEMP B-TREE");
  });

  it("rolls back the whole envelope when one sample fails", async () => {
    await expect(
      store.insertSamples([
        sample("web", "2026-08-09T00:03:00Z", "up"),
        { ...sample("api", "2026-08-09T00:03:00Z", "up"), result: "invalid" as "up" },
      ]),
    ).rejects.toThrow();

    const [samples, aggregates, snapshot] = await Promise.all([
      env.TEST_DB.prepare("SELECT COUNT(*) AS count FROM check_samples").first<{
        count: number;
      }>(),
      env.TEST_DB.prepare("SELECT COUNT(*) AS count FROM daily_uptime").first<{
        count: number;
      }>(),
      store.readStatus(new Date("2026-08-09T00:03:00Z")),
    ]);

    expect(samples?.count).toBe(0);
    expect(aggregates?.count).toBe(0);
    expect(snapshot.monitoringStartedAt).toBeNull();
    expect(snapshot.states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: "web", status: "unknown" }),
        expect.objectContaining({ component: "api", status: "unknown" }),
      ]),
    );
  });
});

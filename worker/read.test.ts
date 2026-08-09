import { describe, expect, it, vi } from "vitest";

import type { ComponentState, PublicComponentStatus } from "../src/status/types";
import type { Env } from "./env";
import {
  createPublicStatusWorker,
  projectPublicStatus,
  type PublicStatusResponse,
} from "./read";
import type { StatusSnapshot, StatusStore } from "./store";

const NOW = new Date("2026-08-09T12:20:00Z");

function state(
  component: "web" | "api",
  status: PublicComponentStatus,
  lastCheckedAt = "2026-08-09T12:18:00Z",
): ComponentState {
  return {
    component,
    status,
    consecutiveFailures: status === "outage" ? 2 : 0,
    lastCheckedAt,
    lastSuccessAt: status === "operational" ? lastCheckedAt : null,
    lastFailureAt: status === "outage" ? lastCheckedAt : null,
  };
}

function snapshot(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    monitoringStartedAt: "2026-08-07T00:03:00Z",
    states: [state("web", "operational"), state("api", "operational")],
    daily: [],
    ...overrides,
  };
}

function createStore(overrides: Partial<StatusStore> = {}): StatusStore {
  return {
    insertSamples: vi.fn(),
    readStatus: vi.fn().mockResolvedValue(snapshot()),
    deleteExpiredSamples: vi.fn(),
    ...overrides,
  };
}

function createEnv(): Env {
  return {
    DB: {} as D1Database,
    ASSETS: {
      fetch: vi.fn().mockResolvedValue(new Response("asset", { status: 200 })),
    } as unknown as Fetcher,
    STATUS_INGEST_SECRET: "test-only-secret",
    STATUS_READ_LIMITER: {
      limit: vi.fn().mockResolvedValue({ success: true }),
    } as RateLimit,
  };
}

type TestCache = Pick<Cache, "match" | "put">;

function createCache(): TestCache {
  const entries = new Map<string, Response>();
  return {
    match: vi.fn(async (request: RequestInfo) => {
      const key = typeof request === "string" ? request : request.url;
      return entries.get(key)?.clone();
    }),
    put: vi.fn(async (request: RequestInfo, response: Response) => {
      const key = typeof request === "string" ? request : request.url;
      entries.set(key, response.clone());
    }),
  };
}

const executionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext;

describe("public status projection", () => {
  it.each([
    ["all operational", "operational", "operational", "operational"],
    ["unknown takes precedence over operational", "unknown", "operational", "verification_unavailable"],
    ["outage takes precedence over unknown", "outage", "unknown", "service_disruption"],
  ] as const)("uses overall precedence: %s", (_case, web, api, overall) => {
    const response = projectPublicStatus(
      snapshot({ states: [state("web", web), state("api", api)] }),
      NOW,
    );

    expect(response.overall).toBe(overall);
  });

  it("derives stale stored state as verification unavailable at read time", () => {
    const response = projectPublicStatus(
      snapshot({
        states: [
          state("web", "operational", "2026-08-09T12:04:59Z"),
          state("api", "operational"),
        ],
      }),
      NOW,
    );

    expect(response.overall).toBe("verification_unavailable");
    expect(response.components.find(({ id }) => id === "web")?.status).toBe("unknown");
  });

  it("keeps no-data uptime null instead of inventing 100% or 0%", () => {
    const response = projectPublicStatus(
      snapshot({ monitoringStartedAt: null, daily: [] }),
      NOW,
    );

    expect(response.monitoringStartedAt).toBeNull();
    expect(response.components).toEqual([
      expect.objectContaining({ id: "web", uptime30d: null, coverage30d: 0, days: [] }),
      expect.objectContaining({ id: "api", uptime30d: null, coverage30d: 0, days: [] }),
    ]);
  });

  it("generates missing UTC days with zero coverage", () => {
    const response = projectPublicStatus(
      snapshot({
        monitoringStartedAt: "2026-08-07T00:03:00Z",
        daily: [
          {
            day: "2026-08-07",
            component: "web",
            upSamples: 288,
            downSamples: 0,
            storedExpectedSamples: 288,
            firstScheduledAt: "2026-08-07T00:03:00Z",
            lastScheduledAt: "2026-08-07T23:58:00Z",
          },
        ],
      }),
      NOW,
    );

    const web = response.components.find(({ id }) => id === "web");
    expect(web?.days.map(({ day }) => day)).toEqual([
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
    expect(web?.days[1]).toEqual({
      day: "2026-08-08",
      upSamples: 0,
      downSamples: 0,
      expectedSamples: 288,
      uptimePercent: null,
      coveragePercent: 0,
    });
  });

  it("caps the public graph at 30 UTC days and exposes no internal state columns", () => {
    const response = projectPublicStatus(
      snapshot({ monitoringStartedAt: "2026-06-01T00:03:00Z" }),
      NOW,
    );

    for (const component of response.components) {
      expect(component.days).toHaveLength(30);
    }
    const serialized = JSON.stringify(response);
    for (const internalField of [
      "consecutiveFailures",
      "lastFailureAt",
      "storedExpectedSamples",
      "firstScheduledAt",
      "lastScheduledAt",
    ]) {
      expect(serialized).not.toContain(internalField);
    }
  });
});

describe("public status routing", () => {
  async function fetchStatus(
    request: Request,
    store = createStore(),
    env = createEnv(),
    cache = createCache(),
  ): Promise<{ response: Response; env: Env }> {
    const worker = createPublicStatusWorker({
      now: () => NOW,
      storeFactory: () => store,
      cache,
    });
    return {
      response: await worker.fetch(request, env, executionContext),
      env,
    };
  }

  it("returns the public JSON response with bounded cache and sniffing headers", async () => {
    const { response } = await fetchStatus(
      new Request("https://status.palate.one/api/status"),
    );
    const body = (await response.json()) as PublicStatusResponse;

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=60",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(body.generatedAt).toBe(NOW.toISOString());
  });

  it("rejects cache-busting query strings before D1", async () => {
    const store = createStore();
    const env = createEnv();

    const { response } = await fetchStatus(
      new Request("https://status.palate.one/api/status?nonce=attacker"),
      store,
      env,
    );

    expect(response.status).toBe(400);
    expect(store.readStatus).not.toHaveBeenCalled();
    expect(env.STATUS_READ_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("serves repeated status reads from one canonical cache entry", async () => {
    const store = createStore();
    const env = createEnv();
    const cache = createCache();
    const request = new Request("https://status.palate.one/api/status");

    const first = await fetchStatus(request, store, env, cache);
    const second = await fetchStatus(request, store, env, cache);

    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    expect(store.readStatus).toHaveBeenCalledOnce();
    expect(env.STATUS_READ_LIMITER.limit).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it("returns 429 before D1 when cache-miss budget is exhausted", async () => {
    const store = createStore();
    const env = createEnv();
    vi.mocked(env.STATUS_READ_LIMITER.limit).mockResolvedValue({ success: false });

    const { response } = await fetchStatus(
      new Request("https://status.palate.one/api/status"),
      store,
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(store.readStatus).not.toHaveBeenCalled();
  });

  it("fails closed before D1 when the rate-limit binding rejects", async () => {
    const store = createStore();
    const env = createEnv();
    vi.mocked(env.STATUS_READ_LIMITER.limit).mockRejectedValue(
      new Error("private rate-limit diagnostic"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { response } = await fetchStatus(
      new Request("https://status.palate.one/api/status"),
      store,
      env,
    );
    const logs = errorSpy.mock.calls.flat().join(" ");
    errorSpy.mockRestore();

    expect(response.status).toBe(503);
    expect(store.readStatus).not.toHaveBeenCalled();
    expect(logs).toBe("public status rate limit failed");
    expect(logs).not.toContain("private rate-limit diagnostic");
  });

  it("returns generic 503 without leaking a D1 error", async () => {
    const sensitive = "private D1 diagnostic";
    const store = createStore({
      readStatus: vi.fn().mockRejectedValue(new Error(sensitive)),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cache = createCache();

    const { response } = await fetchStatus(
      new Request("https://status.palate.one/api/status"),
      store,
      createEnv(),
      cache,
    );
    const body = await response.text();
    const logs = errorSpy.mock.calls.flat().join(" ");
    errorSpy.mockRestore();

    expect(response.status).toBe(503);
    expect(body).toBe("temporarily unavailable");
    expect(body).not.toContain(sensitive);
    expect(logs).not.toContain(sensitive);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", "/api/status", "GET"],
    ["GET", "/api/checks", "POST"],
  ])("returns 405 and Allow for %s %s", async (method, path, allow) => {
    const { response } = await fetchStatus(
      new Request(`https://status.palate.one${path}`, { method }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe(allow);
  });

  it("returns 404 for an unsupported API route", async () => {
    const { response } = await fetchStatus(
      new Request("https://status.palate.one/api/internal"),
    );

    expect(response.status).toBe(404);
  });

  it("passes non-API requests to static assets", async () => {
    const env = createEnv();
    const request = new Request("https://status.palate.one/incidents/example");
    const { response } = await fetchStatus(request, createStore(), env);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("asset");
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request);
  });
});

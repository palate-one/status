import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "./env";
import { runScheduledChecks } from "./monitor";
import { createD1StatusStore } from "./store";

const TOKEN = "test-only-bot-token";
const store = createD1StatusStore(env.TEST_DB);

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: env.TEST_DB,
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_CHAT_ID: "42",
    ...overrides,
  } as Env;
}

type Responses = {
  web?: number;
  api?: number;
  body?: unknown;
  telegram?: number | Error;
};

function createFetcher({ web = 200, api = 200, body = { status: "ok" }, telegram = 200 }: Responses) {
  const messages: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.telegram.org/")) {
      messages.push(JSON.parse(String(init?.body)).text);
      if (telegram instanceof Error) throw telegram;
      return new Response(null, { status: telegram });
    }
    if (url === "https://api.palate.one/readyz") {
      return Response.json(body, { status: api });
    }
    return new Response("ok", { status: web });
  }) as unknown as typeof fetch;
  return { fetcher, messages };
}

async function run(at: string, responses: Responses = {}, overrides: Partial<Env> = {}) {
  const now = new Date(at);
  const { fetcher, messages } = createFetcher(responses);
  // Cron은 예약 시각보다 몇 초 늦게 시작할 수 있다.
  await runScheduledChecks(now.getTime() + 4_000, createEnv(overrides), {
    now: () => now,
    fetcher,
  });
  return messages;
}

async function apiState(at: string) {
  const { states } = await store.readStatus(new Date(at));
  return states.find(({ component }) => component === "api")?.status;
}

beforeEach(async () => {
  await env.TEST_DB.batch([
    env.TEST_DB.prepare("DELETE FROM check_samples"),
    env.TEST_DB.prepare("DELETE FROM daily_uptime"),
    env.TEST_DB.prepare(`
      UPDATE component_state
      SET status = 'unknown', consecutive_failures = 0,
          last_checked_at = NULL, last_success_at = NULL, last_failure_at = NULL
    `),
    env.TEST_DB.prepare(`
      UPDATE status_metadata
      SET monitoring_started_at = NULL, latest_day = NULL, states_json = '[]', daily_json = '[]'
      WHERE id = 1
    `),
  ]);
});

/** 정상 관측 뒤 한 번 실패해, 다음 실패에서 장애로 바뀌는 상태를 만든다. */
async function failOnce(responses: Responses, overrides: Partial<Env> = {}) {
  await run("2026-08-09T12:13:00Z", {}, overrides);
  expect(await run("2026-08-09T12:18:00Z", responses, overrides)).toEqual([]);
}

const OUTAGE_AT = "2026-08-09T12:23:00Z";

describe("scheduled monitor", () => {
  it("stores both components in the cron slot", async () => {
    await run("2026-08-09T12:13:00Z");

    const { results } = await env.TEST_DB.prepare(
      "SELECT component, scheduled_at, result FROM check_samples ORDER BY component",
    ).all();
    expect(results).toEqual([
      { component: "api", scheduled_at: "2026-08-09T12:13:00Z", result: "up" },
      { component: "web", scheduled_at: "2026-08-09T12:13:00Z", result: "up" },
    ]);
  });

  it("pages once when an outage is confirmed and once when it recovers", async () => {
    await failOnce({ api: 503 });

    const down = await run(OUTAGE_AT, { api: 503 });
    expect(down).toHaveLength(1);
    expect(down[0]).toContain("🔴 api.palate.one");
    expect(down[0]).toContain("HTTP 503");

    expect(await run("2026-08-09T12:28:00Z", { api: 503 })).toEqual([]);

    const recovered = await run("2026-08-09T12:33:00Z");
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toContain("🟢 api.palate.one");
    expect(await apiState("2026-08-09T12:33:00Z")).toBe("operational");
  });

  it("pages for each component that fails", async () => {
    await failOnce({ web: 500, api: 503 });

    const messages = await run(OUTAGE_AT, { web: 500, api: 503 });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("🔴 palate.one");
    expect(messages[1]).toContain("🔴 api.palate.one");
  });

  it("reports a wrong body instead of its 200 status", async () => {
    await failOnce({ body: { status: "degraded" } });

    const [message] = await run(OUTAGE_AT, { body: { status: "degraded" } });
    expect(message).toContain("body_mismatch");
    expect(message).not.toContain("HTTP 200");
  });

  it("pages once when the outage slot runs twice at the same time", async () => {
    await failOnce({ api: 503 });

    const messages = await Promise.all([
      run(OUTAGE_AT, { api: 503 }),
      run(OUTAGE_AT, { api: 503 }),
    ]);
    expect(messages.flat()).toHaveLength(1);
  });

  it("keeps the observation without telegram secrets", async () => {
    const secrets = { TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await failOnce({ api: 503 }, secrets);
    expect(await run(OUTAGE_AT, { api: 503 }, secrets)).toEqual([]);
    warn.mockRestore();

    expect(await apiState(OUTAGE_AT)).toBe("outage");
  });

  it.each([
    ["an HTTP error", 500, "telegram returned HTTP 500"],
    ["a thrown error", new Error(`failed ${TOKEN}`), "telegram request failed"],
  ])("keeps the observation and the token private on %s", async (_, telegram, log) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await failOnce({ api: 503 });
    await run(OUTAGE_AT, { api: 503, telegram });
    const logs = error.mock.calls.flat().join(" ");
    error.mockRestore();

    expect(await apiState(OUTAGE_AT)).toBe("outage");
    expect(logs).toContain(log);
    expect(logs).not.toContain(TOKEN);
  });

  it("keeps the observation when the 35-day cleanup fails without logging the error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const deleteExpiredSamples = vi.fn().mockRejectedValue(new Error("private detail"));
    const now = new Date("2026-08-09T12:13:00Z");

    await runScheduledChecks(now.getTime(), createEnv(), {
      now: () => now,
      fetcher: createFetcher({}).fetcher,
      storeFactory: (db) => ({ ...createD1StatusStore(db), deleteExpiredSamples }),
    });
    const logs = error.mock.calls.flat().join(" ");
    error.mockRestore();

    expect(deleteExpiredSamples).toHaveBeenCalledWith(new Date("2026-07-05T12:13:00Z"), 1_000);
    expect(await apiState("2026-08-09T12:13:00Z")).toBe("operational");
    expect(logs).toBe("status retention failed");
  });
});

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

/** Web은 늘 정상이고 API만 주어진 상태 코드로 응답한다. */
function createFetcher(apiStatus: number, telegramStatus = 200) {
  const messages: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.telegram.org/")) {
      messages.push(JSON.parse(String(init?.body)).text);
      return new Response(null, { status: telegramStatus });
    }
    if (url === "https://api.palate.one/readyz") {
      return Response.json({ status: "ok" }, { status: apiStatus });
    }
    return new Response("ok");
  }) as unknown as typeof fetch;
  return { fetcher, messages };
}

async function run(at: string, apiStatus: number, overrides: Partial<Env> = {}, telegram = 200) {
  const now = new Date(at);
  const { fetcher, messages } = createFetcher(apiStatus, telegram);
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

describe("scheduled monitor", () => {
  it("stores both components in the cron slot", async () => {
    await run("2026-08-09T12:13:00Z", 200);

    const { results } = await env.TEST_DB.prepare(
      "SELECT component, scheduled_at, result FROM check_samples ORDER BY component",
    ).all();
    expect(results).toEqual([
      { component: "api", scheduled_at: "2026-08-09T12:13:00Z", result: "up" },
      { component: "web", scheduled_at: "2026-08-09T12:13:00Z", result: "up" },
    ]);
  });

  it("pages once when an outage is confirmed and once when it recovers", async () => {
    expect(await run("2026-08-09T12:13:00Z", 200)).toEqual([]);
    expect(await run("2026-08-09T12:18:00Z", 503)).toEqual([]);

    const down = await run("2026-08-09T12:23:00Z", 503);
    expect(down).toHaveLength(1);
    expect(down[0]).toContain("api.palate.one API가 응답하지 않아요");
    expect(down[0]).toContain("HTTP 503");

    expect(await run("2026-08-09T12:28:00Z", 503)).toEqual([]);

    const recovered = await run("2026-08-09T12:33:00Z", 200);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toContain("api.palate.one API가 복구됐어요");
    expect(await apiState("2026-08-09T12:33:00Z")).toBe("operational");
  });

  it("does not page or count again when the same slot runs twice", async () => {
    await run("2026-08-09T12:13:00Z", 200);
    await run("2026-08-09T12:18:00Z", 503);
    expect(await run("2026-08-09T12:18:00Z", 503)).toEqual([]);
    expect(await apiState("2026-08-09T12:18:00Z")).toBe("operational");
  });

  it("keeps the observation without telegram secrets", async () => {
    const secrets = { TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await run("2026-08-09T12:13:00Z", 200, secrets);
    await run("2026-08-09T12:18:00Z", 503, secrets);
    expect(await run("2026-08-09T12:23:00Z", 503, secrets)).toEqual([]);
    warn.mockRestore();

    expect(await apiState("2026-08-09T12:23:00Z")).toBe("outage");
  });

  it("keeps the observation and the token private when telegram fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await run("2026-08-09T12:13:00Z", 200);
    await run("2026-08-09T12:18:00Z", 503);
    await run("2026-08-09T12:23:00Z", 503, {}, 500);
    const logs = error.mock.calls.flat().join(" ");
    error.mockRestore();

    expect(await apiState("2026-08-09T12:23:00Z")).toBe("outage");
    expect(logs).toContain("telegram returned HTTP 500");
    expect(logs).not.toContain(TOKEN);
  });
});

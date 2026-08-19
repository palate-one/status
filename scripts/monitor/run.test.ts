import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { signBody } from "../../worker/signature";
import { runMonitor, scheduledSlot, sendChecks } from "./run";

const NOW = new Date("2026-08-09T12:17:42Z");
const SECRET = "test-only-monitor-secret";
const ENDPOINT = "https://status.palate.one/api/checks";

function fetchMock(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return vi.fn(implementation) as unknown as typeof fetch;
}

describe("scheduled monitor slot", () => {
  it.each([
    ["delayed job", "2026-08-09T12:17:42Z", "2026-08-09T12:13:00Z"],
    ["exact slot", "2026-08-09T12:03:59Z", "2026-08-09T12:03:00Z"],
    ["before first hourly slot", "2026-08-09T12:02:00Z", "2026-08-09T11:58:00Z"],
    ["UTC day rollover", "2026-08-09T00:01:00Z", "2026-08-08T23:58:00Z"],
  ])("maps a %s to the latest :03 + 5n slot", (_case, now, expected) => {
    expect(scheduledSlot(new Date(now))).toBe(expected);
  });
});

describe("signed check delivery", () => {
  it("sends both checks in one exact signed body", async () => {
    let deliveredBody = "";
    let deliveredHeaders = new Headers();
    const fetcher = fetchMock(async (_input, init) => {
      deliveredBody = String(init?.body);
      deliveredHeaders = new Headers(init?.headers);
      return new Response(null, { status: 204 });
    });
    const checks = [
      {
        component: "web" as const,
        checkedAt: "2026-08-09T12:17:42Z",
        result: "up" as const,
        latencyMs: 120,
        httpStatus: 200,
        failureCode: null,
      },
      {
        component: "api" as const,
        checkedAt: "2026-08-09T12:17:43Z",
        result: "down" as const,
        latencyMs: 2_000,
        httpStatus: 503,
        failureCode: "http_status" as const,
      },
    ];

    await sendChecks({
      endpoint: ENDPOINT,
      secret: SECRET,
      scheduledAt: "2026-08-09T12:13:00Z",
      checks,
      now: NOW,
      fetcher,
    });

    const timestamp = deliveredHeaders.get("X-Status-Timestamp") ?? "";
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(ENDPOINT);
    expect(vi.mocked(fetcher).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(deliveredHeaders.get("Content-Type")).toBe("application/json");
    expect(timestamp).toBe("1786277862");
    expect(deliveredHeaders.get("X-Status-Signature")).toBe(
      await signBody(SECRET, timestamp, deliveredBody),
    );
    expect(JSON.parse(deliveredBody)).toEqual({
      version: 1,
      scheduledAt: "2026-08-09T12:13:00Z",
      sentAt: "2026-08-09T12:17:42Z",
      checks,
    });
  });

  it("refuses to send the secret to an unapproved endpoint", async () => {
    const fetcher = fetchMock(async () => new Response(null, { status: 204 }));

    await expect(
      sendChecks({
        endpoint: "https://example.com/api/checks",
        secret: SECRET,
        scheduledAt: "2026-08-09T12:13:00Z",
        checks: [],
        now: NOW,
        fetcher,
      }),
    ).rejects.toThrow("invalid ingestion configuration");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never follows a redirect with the signed ingestion body", async () => {
    const requested: string[] = [];
    let fetcher: typeof fetch;
    fetcher = fetchMock(async (input, init) => {
      const url = String(input);
      requested.push(url);
      if (url === ENDPOINT) {
        if (init?.redirect === "manual") {
          return new Response(null, {
            status: 307,
            headers: { Location: "https://example.com/steal" },
          });
        }
        return fetcher("https://example.com/steal", init);
      }
      return new Response(null, { status: 204 });
    });

    await expect(
      sendChecks({
        endpoint: ENDPOINT,
        secret: SECRET,
        scheduledAt: "2026-08-09T12:13:00Z",
        checks: [
          {
            component: "web",
            checkedAt: "2026-08-09T12:17:42Z",
            result: "up",
            latencyMs: 120,
            httpStatus: 200,
            failureCode: null,
          },
          {
            component: "api",
            checkedAt: "2026-08-09T12:17:43Z",
            result: "up",
            latencyMs: 90,
            httpStatus: 200,
            failureCode: null,
          },
        ],
        now: NOW,
        fetcher,
      }),
    ).rejects.toThrow("status ingestion failed");

    expect(requested).toEqual([ENDPOINT]);
  });
});

describe("monitor run ordering and redaction", () => {
  it("delivers a down observation before writing summary without failing", async () => {
    const events: string[] = [];
    let summary = "";
    const fetcher = fetchMock(async (input) => {
      const url = String(input);
      if (url === ENDPOINT) {
        events.push("delivered");
        return new Response(null, { status: 204 });
      }
      if (url === "https://api.palate.one/readyz") {
        return Response.json({ status: "ok" });
      }
      return new Response(null, { status: 503 });
    });

    await expect(
      runMonitor({
        endpoint: ENDPOINT,
        secret: SECRET,
        startedAt: NOW,
        sentAt: () => NOW,
        fetcher,
        writeSummary: async (value) => {
          events.push("summary");
          summary = value;
        },
      }),
    ).resolves.toBeUndefined();

    expect(events).toEqual(["delivered", "summary"]);
    expect(summary).toContain("Web");
    expect(summary).toContain("실패");
    expect(summary).not.toContain(SECRET);
    expect(summary).not.toContain("X-Status-Signature");
    expect(summary).not.toContain("{\"version\"");
  });

  it("turns ingestion errors into a generic failure after a redacted summary", async () => {
    let rawBody = "";
    let signature = "";
    let summary = "";
    const fetcher = fetchMock(async (input, init) => {
      const url = String(input);
      if (url === ENDPOINT) {
        rawBody = String(init?.body);
        signature = new Headers(init?.headers).get("X-Status-Signature") ?? "";
        throw new Error(`${SECRET} ${signature} ${rawBody}`);
      }
      if (url === "https://api.palate.one/readyz") {
        return Response.json({ status: "ok" });
      }
      return new Response(null, { status: 200 });
    });

    await expect(
      runMonitor({
        endpoint: ENDPOINT,
        secret: SECRET,
        startedAt: NOW,
        sentAt: () => NOW,
        fetcher,
        writeSummary: async (value) => {
          summary = value;
        },
      }),
    ).rejects.toThrow("status ingestion failed");

    for (const sensitive of [SECRET, signature, rawBody]) {
      expect(summary).not.toContain(sensitive);
    }
  });
});

describe("monitor workflow", () => {
  it("uses the five-minute schedule and least-privilege pinned actions", async () => {
    const workflow = await readFile(".github/workflows/monitor.yml", "utf8");

    expect(workflow).toContain('cron: "3-58/5 * * * *"');
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("timeout-minutes: 2");
    expect(workflow).toContain(
      "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
    );
    expect(workflow).toContain(
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
    );
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("vars.STATUS_INGEST_URL");
    expect(workflow).toContain("secrets.STATUS_INGEST_SECRET");
  });
});

import { describe, expect, it, vi } from "vitest";

import type { Env, IngestPayload } from "./env";
import { createWorker } from "./ingest";
import { signBody } from "./signature";
import type { StatusStore } from "./store";

const SECRET = "test-only-ingestion-secret-do-not-log";
const NOW = new Date("2026-08-09T12:00:00Z");
const TIMESTAMP = String(NOW.getTime() / 1_000);

const validPayload: IngestPayload = {
  version: 1,
  scheduledAt: "2026-08-09T11:58:00Z",
  sentAt: "2026-08-09T12:00:00Z",
  checks: [
    {
      component: "web",
      checkedAt: "2026-08-09T11:58:01Z",
      result: "up",
      latencyMs: 125,
      httpStatus: 200,
      failureCode: null,
    },
    {
      component: "api",
      checkedAt: "2026-08-09T11:58:02Z",
      result: "down",
      latencyMs: 2_500,
      httpStatus: 503,
      failureCode: "http_status",
    },
  ],
};

function createStore(overrides: Partial<StatusStore> = {}): StatusStore {
  return {
    insertSample: vi.fn().mockResolvedValue({ inserted: true }),
    readStatus: vi.fn(),
    deleteExpiredSamples: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

const env = {
  DB: {} as D1Database,
  ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
  STATUS_INGEST_SECRET: SECRET,
} satisfies Env;

const executionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext;

async function signedRequest(
  payload: unknown = validPayload,
  init: { rawBody?: string; signature?: string; timestamp?: string } = {},
): Promise<Request> {
  const rawBody = init.rawBody ?? JSON.stringify(payload);
  const timestamp = init.timestamp ?? TIMESTAMP;
  const signature = init.signature ?? (await signBody(SECRET, timestamp, rawBody));

  return new Request("https://status.palate.one/api/checks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Status-Timestamp": timestamp,
      "X-Status-Signature": signature,
    },
    body: rawBody,
  });
}

async function fetchWith(store: StatusStore, request: Request): Promise<Response> {
  const worker = createWorker({
    now: () => NOW,
    storeFactory: () => store,
  });
  return worker.fetch(request, env, executionContext);
}

describe("status ingestion handler", () => {
  it("returns 415 without reading a non-JSON request", async () => {
    const store = createStore();
    const request = new Request("https://status.palate.one/api/checks", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "sensitive raw body",
    });

    const response = await fetchWith(store, request);

    expect(response.status).toBe(415);
    expect(store.insertSample).not.toHaveBeenCalled();
  });

  it("returns 413 before parsing a body larger than 8 KiB", async () => {
    const store = createStore();
    const request = await signedRequest(undefined, { rawBody: "x".repeat(8_193) });

    const response = await fetchWith(store, request);

    expect(response.status).toBe(413);
    expect(store.insertSample).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown root field", { ...validPayload, unexpected: true }],
    ["wrong version", { ...validPayload, version: 2 }],
    ["missing component", { ...validPayload, checks: [validPayload.checks[0]] }],
    [
      "duplicate component",
      { ...validPayload, checks: [validPayload.checks[0], validPayload.checks[0]] },
    ],
    ["unnormalized slot", { ...validPayload, scheduledAt: "2026-08-09T11:59:00Z" }],
    [
      "unknown check field",
      {
        ...validPayload,
        checks: [{ ...validPayload.checks[0], detail: "secret" }, validPayload.checks[1]],
      },
    ],
  ])("returns generic 400 for %s", async (_case, payload) => {
    const store = createStore();

    const response = await fetchWith(store, await signedRequest(payload));

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("invalid request");
    expect(store.insertSample).not.toHaveBeenCalled();
  });

  it("returns generic 401 for an invalid signature", async () => {
    const store = createStore();
    const signature = `sha256=${"0".repeat(64)}`;
    const rawBody = JSON.stringify(validPayload);

    const response = await fetchWith(
      store,
      await signedRequest(validPayload, { rawBody, signature }),
    );
    const responseBody = await response.text();

    expect(response.status).toBe(401);
    expect(responseBody).toBe("unauthorized");
    expect(responseBody).not.toContain(rawBody);
    expect(responseBody).not.toContain(signature);
    expect(responseBody).not.toContain(SECRET);
  });

  it("returns generic 401 when the header timestamp differs from sentAt", async () => {
    const store = createStore();
    const timestamp = String(Number(TIMESTAMP) - 1);

    const response = await fetchWith(
      store,
      await signedRequest(validPayload, { timestamp }),
    );

    expect(response.status).toBe(401);
    expect(store.insertSample).not.toHaveBeenCalled();
  });

  it.each([
    ["insert", true],
    ["duplicate replay", false],
  ])("returns 204 for an accepted %s", async (_case, inserted) => {
    const store = createStore({
      insertSample: vi.fn().mockResolvedValue({ inserted }),
    });

    const response = await fetchWith(store, await signedRequest());

    expect(response.status).toBe(204);
    expect(store.insertSample).toHaveBeenCalledTimes(2);
    expect(store.insertSample).toHaveBeenNthCalledWith(1, {
      ...validPayload.checks[0],
      scheduledAt: validPayload.scheduledAt,
    });
    expect(store.insertSample).toHaveBeenNthCalledWith(2, {
      ...validPayload.checks[1],
      scheduledAt: validPayload.scheduledAt,
    });
    expect(store.deleteExpiredSamples).toHaveBeenCalledWith(
      new Date("2026-07-05T12:00:00Z"),
      1_000,
    );
    expect(executionContext.waitUntil).not.toHaveBeenCalled();
  });

  it("returns generic 503 and never logs request secrets when D1 fails", async () => {
    const rawBody = JSON.stringify(validPayload);
    const signature = await signBody(SECRET, TIMESTAMP, rawBody);
    const store = createStore({
      insertSample: vi
        .fn()
        .mockRejectedValue(new Error(`${SECRET} ${signature} ${rawBody}`)),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await fetchWith(
      store,
      await signedRequest(validPayload, { rawBody, signature }),
    );
    const responseBody = await response.text();
    const logs = errorSpy.mock.calls.flat().join(" ");
    errorSpy.mockRestore();

    expect(response.status).toBe(503);
    expect(responseBody).toBe("temporarily unavailable");
    for (const sensitive of [SECRET, signature, rawBody]) {
      expect(responseBody).not.toContain(sensitive);
      expect(logs).not.toContain(sensitive);
    }
  });
});

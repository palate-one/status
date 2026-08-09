import { describe, expect, it, vi } from "vitest";

import { checkApi, checkWeb } from "./checks";

const NOW = new Date("2026-08-09T12:17:42Z");

function fetchMock(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return vi.fn(implementation) as unknown as typeof fetch;
}

describe("web monitor", () => {
  it("accepts a 2xx response from the fixed final host", async () => {
    const fetcher = fetchMock(async () => new Response(null, { status: 204 }));

    const check = await checkWeb(fetcher, NOW);

    expect(check).toMatchObject({
      component: "web",
      checkedAt: "2026-08-09T12:17:42Z",
      result: "up",
      httpStatus: 204,
      failureCode: null,
    });
    expect(check.latencyMs).toBeGreaterThanOrEqual(0);
    expect(check.latencyMs).toBeLessThanOrEqual(120_000);
  });

  it("follows at most three same-host redirects manually", async () => {
    const fetcher = fetchMock(async (input) => {
      const pathname = new URL(String(input)).pathname;
      const next = new Map([
        ["/", [301, "/one"]],
        ["/one", [302, "/two"]],
        ["/two", [307, "/final"]],
      ]).get(pathname);
      return next
        ? new Response(null, { status: next[0] as number, headers: { Location: next[1] as string } })
        : new Response(null, { status: 200 });
    });

    const check = await checkWeb(fetcher, NOW);

    expect(check.result).toBe("up");
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [, init] of vi.mocked(fetcher).mock.calls) {
      expect(init?.redirect).toBe("manual");
    }
  });

  it("rejects a host-changing redirect without requesting the new host", async () => {
    const fetcher = fetchMock(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://example.com/private" },
      }),
    );

    const check = await checkWeb(fetcher, NOW);

    expect(check).toMatchObject({ result: "down", failureCode: "body_mismatch" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetcher).mock.calls.flat().join(" ")).not.toContain("example.com");
  });

  it("stops redirect loops", async () => {
    const fetcher = fetchMock(async (input) => {
      const pathname = new URL(String(input)).pathname;
      return new Response(null, {
        status: 302,
        headers: { Location: pathname === "/" ? "/loop" : "/" },
      });
    });

    const check = await checkWeb(fetcher, NOW);

    expect(check).toMatchObject({ result: "down", failureCode: "body_mismatch" });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});

describe("API monitor", () => {
  it("accepts only a 200 JSON readiness response with status ok", async () => {
    const fetcher = fetchMock(async () =>
      Response.json({ status: "ok" }, { status: 200 }),
    );

    const check = await checkApi(fetcher, NOW);

    expect(check).toMatchObject({
      component: "api",
      checkedAt: "2026-08-09T12:17:42Z",
      result: "up",
      httpStatus: 200,
      failureCode: null,
    });
  });

  it.each([
    ["body mismatch", () => Response.json({ status: "starting" }), "body_mismatch"],
    ["invalid JSON", () => new Response("not-json", { status: 200 }), "body_mismatch"],
    ["non-2xx", () => new Response(null, { status: 503 }), "http_status"],
    ["redirect", () => new Response(null, { status: 302 }), "http_status"],
  ] as const)("maps %s to an allowlisted failure", async (_case, response, failureCode) => {
    const fetcher = fetchMock(async () => response());

    const check = await checkApi(fetcher, NOW);

    expect(check).toMatchObject({ result: "down", failureCode });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of vi.mocked(fetcher).mock.calls) {
      expect(init?.redirect).toBe("manual");
    }
  });

  it("retries once and records a recovered check as up", async () => {
    const fetcher = fetchMock(
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("temporary network failure"))
        .mockResolvedValueOnce(Response.json({ status: "ok" })),
    );

    const check = await checkApi(fetcher, NOW);

    expect(check.result).toBe("up");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["timeout", new DOMException("timed out", "AbortError"), "timeout"],
    ["dns", Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }), "dns"],
    ["tls", Object.assign(new TypeError("fetch failed"), { cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" } }), "tls"],
    ["network", new TypeError("fetch failed"), "network"],
  ] as const)("maps %s errors without raw details", async (_case, error, failureCode) => {
    const fetcher = fetchMock(async () => {
      throw error;
    });

    const check = await checkApi(fetcher, NOW);

    expect(check).toMatchObject({
      result: "down",
      httpStatus: null,
      failureCode,
    });
    expect(check.latencyMs).toBeGreaterThanOrEqual(0);
    expect(check.latencyMs).toBeLessThanOrEqual(120_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

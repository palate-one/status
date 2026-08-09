import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublicStatusResponse } from "../../worker/read";
import {
  isPublicStatusResponse,
  scheduleStaleTransition,
} from "./status-client";

function response(): PublicStatusResponse {
  return {
    generatedAt: "2026-08-09T12:00:00Z",
    monitoringStartedAt: "2026-08-01T00:03:00Z",
    overall: "operational",
    components: [
      {
        id: "web",
        label: "Web",
        status: "operational",
        lastCheckedAt: "2026-08-09T12:00:00Z",
        lastSuccessAt: "2026-08-09T12:00:00Z",
        uptime30d: 100,
        coverage30d: 100,
        days: [],
      },
      {
        id: "api",
        label: "API",
        status: "operational",
        lastCheckedAt: "2026-08-09T12:00:00Z",
        lastSuccessAt: "2026-08-09T12:00:00Z",
        uptime30d: 100,
        coverage30d: 100,
        days: [],
      },
    ],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("public status response validation", () => {
  it("requires exactly one correctly paired Web and API component", () => {
    const valid = response();
    const cases: Array<[string, PublicStatusResponse]> = [
      ["empty", { ...valid, components: [] }],
      ["single", { ...valid, components: valid.components.slice(0, 1) }],
      ["duplicate", { ...valid, components: [valid.components[0], valid.components[0]] }],
      [
        "mismatched label",
        {
          ...valid,
          components: [{ ...valid.components[0], label: "API" }, valid.components[1]],
        },
      ],
    ];

    expect(isPublicStatusResponse(valid)).toBe(true);
    for (const [_case, payload] of cases) {
      expect(isPublicStatusResponse(payload)).toBe(false);
    }
  });
});

describe("long-lived status tabs", () => {
  it("transitions to unknown only after the strict 15-minute boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:00:00Z"));
    const render = vi.fn();

    const cancel = scheduleStaleTransition(response(), render);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1_000);
    expect(render).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][0].overallStatus).toBe("verification_unavailable");
    expect(
      render.mock.calls[0][0].components.every(
        ({ status }: { status: string }) => status === "unknown",
      ),
    ).toBe(true);

    cancel();
  });

  it("can cancel a pending stale transition", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:00:00Z"));
    const render = vi.fn();

    const cancel = scheduleStaleTransition(response(), render);
    cancel();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1_000 + 1);

    expect(render).not.toHaveBeenCalled();
  });
});

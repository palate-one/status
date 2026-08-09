import { describe, expect, it } from "vitest";
import { applySample, derivePublicState } from "./state";
import type { CheckSample, ComponentState } from "./types";

const baseState = (): ComponentState => ({
  component: "api",
  status: "unknown",
  consecutiveFailures: 0,
  lastCheckedAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
});

const sample = (
  result: CheckSample["result"],
  checkedAt: string,
): CheckSample => ({
  component: "api",
  scheduledAt: checkedAt,
  checkedAt,
  result,
  latencyMs: result === "up" ? 80 : 120_000,
  httpStatus: result === "up" ? 200 : null,
  failureCode: result === "up" ? null : "timeout",
});

describe("component status transitions", () => {
  it.each([
    {
      name: "initial unknown plus up becomes operational",
      initial: baseState(),
      samples: [sample("up", "2026-08-09T00:03:00Z")],
      expected: { status: "operational", consecutiveFailures: 0 },
    },
    {
      name: "operational plus first down stays operational",
      initial: {
        ...baseState(),
        status: "operational" as const,
        lastCheckedAt: "2026-08-09T00:03:00Z",
        lastSuccessAt: "2026-08-09T00:03:00Z",
      },
      samples: [sample("down", "2026-08-09T00:08:00Z")],
      expected: { status: "operational", consecutiveFailures: 1 },
    },
    {
      name: "second consecutive down becomes outage",
      initial: {
        ...baseState(),
        status: "operational" as const,
        lastCheckedAt: "2026-08-09T00:03:00Z",
        lastSuccessAt: "2026-08-09T00:03:00Z",
      },
      samples: [
        sample("down", "2026-08-09T00:08:00Z"),
        sample("down", "2026-08-09T00:13:00Z"),
      ],
      expected: { status: "outage", consecutiveFailures: 2 },
    },
    {
      name: "outage plus up recovers immediately",
      initial: {
        ...baseState(),
        status: "outage" as const,
        consecutiveFailures: 2,
        lastCheckedAt: "2026-08-09T00:08:00Z",
        lastFailureAt: "2026-08-09T00:08:00Z",
      },
      samples: [sample("up", "2026-08-09T00:13:00Z")],
      expected: { status: "operational", consecutiveFailures: 0 },
    },
  ])("$name", ({ initial, samples, expected }) => {
    const result = samples.reduce(applySample, initial);

    expect(result).toMatchObject(expected);
  });

  it("derives unknown after the last sample is older than fifteen minutes", () => {
    const state: ComponentState = {
      ...baseState(),
      status: "operational",
      lastCheckedAt: "2026-08-09T00:03:00Z",
      lastSuccessAt: "2026-08-09T00:03:00Z",
    };

    expect(
      derivePublicState(state, new Date("2026-08-09T00:18:01Z")),
    ).toMatchObject({ status: "unknown", consecutiveFailures: 0 });
    expect(state.status).toBe("operational");
  });

  it("starts a fresh failure sequence after a stale stored state", () => {
    const state: ComponentState = {
      ...baseState(),
      status: "outage",
      consecutiveFailures: 4,
      lastCheckedAt: "2026-08-09T00:00:00Z",
      lastFailureAt: "2026-08-09T00:00:00Z",
    };

    const result = applySample(state, sample("down", "2026-08-09T00:20:00Z"));

    expect(result).toMatchObject({ status: "unknown", consecutiveFailures: 1 });
  });

  it("reaches outage after two failures following a stale state", () => {
    const state: ComponentState = {
      ...baseState(),
      status: "outage",
      consecutiveFailures: 4,
      lastCheckedAt: "2026-08-09T00:00:00Z",
      lastFailureAt: "2026-08-09T00:00:00Z",
    };

    const result = [
      sample("down", "2026-08-09T00:20:00Z"),
      sample("down", "2026-08-09T00:25:00Z"),
    ].reduce(applySample, state);

    expect(result).toMatchObject({ status: "outage", consecutiveFailures: 2 });
  });
});

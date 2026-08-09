import type { CheckSample, ComponentState } from "./types";

const STALE_AFTER_MS = 15 * 60 * 1000;

function timestampMs(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new RangeError(`invalid timestamp: ${value}`);
  }
  return timestamp;
}

function isStale(lastCheckedAt: string | null, referenceMs: number): boolean {
  if (lastCheckedAt === null) {
    return true;
  }

  return referenceMs - timestampMs(lastCheckedAt) > STALE_AFTER_MS;
}

export function applySample(
  state: ComponentState,
  sample: CheckSample,
): ComponentState {
  if (state.component !== sample.component) {
    throw new Error("sample component does not match state component");
  }

  const checkedAtMs = timestampMs(sample.checkedAt);
  const stale =
    state.lastCheckedAt !== null && isStale(state.lastCheckedAt, checkedAtMs);
  const failureCount = stale ? 0 : state.consecutiveFailures;

  const nextState: ComponentState = {
    ...state,
    lastCheckedAt: sample.checkedAt,
  };

  if (sample.result === "up") {
    return {
      ...nextState,
      status: "operational",
      consecutiveFailures: 0,
      lastSuccessAt: sample.checkedAt,
    };
  }

  const consecutiveFailures = failureCount + 1;
  let status: ComponentState["status"];
  if (consecutiveFailures >= 2 || (!stale && state.status === "outage")) {
    status = "outage";
  } else if (stale || state.status === "unknown") {
    status = "unknown";
  } else {
    status = "operational";
  }

  return {
    ...nextState,
    status,
    consecutiveFailures,
    lastFailureAt: sample.checkedAt,
  };
}

export function derivePublicState(
  state: ComponentState,
  now: Date,
): ComponentState {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("invalid current time");
  }

  if (isStale(state.lastCheckedAt, nowMs)) {
    return {
      ...state,
      status: "unknown",
      consecutiveFailures: 0,
    };
  }

  return { ...state };
}

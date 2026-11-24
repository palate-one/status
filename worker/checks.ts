import type {
  CheckSample,
  ComponentId,
  FailureCode,
} from "../src/status/types";

const WEB_TARGET = "https://palate.one/";
const API_TARGET = "https://api.palate.one/readyz";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_LATENCY_MS = 120_000;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export type MonitorCheck = Omit<CheckSample, "scheduledAt">;

type AttemptResult = Pick<
  MonitorCheck,
  "result" | "httpStatus" | "failureCode"
>;

export function isoSecond(value: Date): string {
  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new RangeError("invalid monitor time");
  }
  return new Date(Math.floor(timestamp / 1_000) * 1_000)
    .toISOString()
    .replace(".000Z", "Z");
}

function boundedLatency(startedAt: number): number {
  const elapsed = Math.round(performance.now() - startedAt);
  return Math.min(MAX_LATENCY_MS, Math.max(0, elapsed));
}

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }

  const record = error as {
    name?: unknown;
    code?: unknown;
    cause?: { code?: unknown };
  };
  return [record.name, record.code, record.cause?.code]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toUpperCase();
}

function failureForError(error: unknown): FailureCode {
  const code = errorCode(error);
  if (code.includes("ABORT") || code.includes("TIMEOUT")) {
    return "timeout";
  }
  if (code.includes("ENOTFOUND") || code.includes("EAI_AGAIN") || code.includes("DNS")) {
    return "dns";
  }
  if (
    code.includes("ERR_TLS") ||
    code.includes("CERT_") ||
    code.includes("CERTIFICATE") ||
    code.includes("SELF_SIGNED") ||
    code.includes("UNABLE_TO_VERIFY")
  ) {
    return "tls";
  }
  return "network";
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The observation is based on status and redirect headers only.
  }
}

async function observeWithOneRetry(
  component: ComponentId,
  now: Date,
  attempt: () => Promise<AttemptResult>,
): Promise<MonitorCheck> {
  const startedAt = performance.now();
  let result: AttemptResult;

  try {
    result = await attempt();
  } catch (error) {
    result = { result: "down", httpStatus: null, failureCode: failureForError(error) };
  }

  if (result.result === "down") {
    try {
      result = await attempt();
    } catch (error) {
      result = {
        result: "down",
        httpStatus: null,
        failureCode: failureForError(error),
      };
    }
  }

  return {
    component,
    checkedAt: isoSecond(now),
    latencyMs: boundedLatency(startedAt),
    ...result,
  };
}

async function checkWebAttempt(fetcher: typeof fetch): Promise<AttemptResult> {
  let currentUrl = WEB_TARGET;
  let redirects = 0;
  const visited = new Set<string>();

  while (true) {
    if (visited.has(currentUrl)) {
      return { result: "down", httpStatus: null, failureCode: "body_mismatch" };
    }
    visited.add(currentUrl);

    const response = await fetchWithTimeout(fetcher, currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });

    if (redirectStatuses.has(response.status)) {
      const location = response.headers.get("Location");
      await discardBody(response);
      if (location === null || redirects >= 3) {
        return {
          result: "down",
          httpStatus: response.status,
          failureCode: "body_mismatch",
        };
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        return {
          result: "down",
          httpStatus: response.status,
          failureCode: "body_mismatch",
        };
      }

      if (
        nextUrl.protocol !== "https:" ||
        nextUrl.hostname !== "palate.one" ||
        nextUrl.port !== "" ||
        nextUrl.username !== "" ||
        nextUrl.password !== ""
      ) {
        return {
          result: "down",
          httpStatus: response.status,
          failureCode: "body_mismatch",
        };
      }

      currentUrl = nextUrl.href;
      redirects += 1;
      continue;
    }

    if (response.status >= 200 && response.status < 300) {
      await discardBody(response);
      return { result: "up", httpStatus: response.status, failureCode: null };
    }
    await discardBody(response);
    return {
      result: "down",
      httpStatus: response.status,
      failureCode: "http_status",
    };
  }
}

async function checkApiAttempt(fetcher: typeof fetch): Promise<AttemptResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetcher(API_TARGET, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) {
      await discardBody(response);
      return {
        result: "down",
        httpStatus: response.status,
        failureCode: "http_status",
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { result: "down", httpStatus: 200, failureCode: "body_mismatch" };
    }

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      (body as { status?: unknown }).status !== "ok"
    ) {
      return { result: "down", httpStatus: 200, failureCode: "body_mismatch" };
    }
    return { result: "up", httpStatus: 200, failureCode: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkWeb(
  fetcher: typeof fetch,
  now: Date,
): Promise<MonitorCheck> {
  return observeWithOneRetry("web", now, () => checkWebAttempt(fetcher));
}

export async function checkApi(
  fetcher: typeof fetch,
  now: Date,
): Promise<MonitorCheck> {
  return observeWithOneRetry("api", now, () => checkApiAttempt(fetcher));
}

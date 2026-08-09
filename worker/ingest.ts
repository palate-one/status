import type { CheckSample, FailureCode } from "../src/status/types";
import type { Env, IngestPayload } from "./env";
import { verifySignedBody } from "./signature";
import { createD1StatusStore, type StatusStore } from "./store";

const MAX_BODY_BYTES = 8 * 1_024;
const RETENTION_DAYS = 35;
const RETENTION_BATCH_SIZE = 1_000;
const exactSecondPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const normalizedSlotPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/;
const failureCodes = new Set<FailureCode>([
  "timeout",
  "dns",
  "tls",
  "network",
  "http_status",
  "body_mismatch",
]);

export type WorkerOptions = {
  now?: () => Date;
  storeFactory?: (db: D1Database) => StatusStore;
};

class BodyTooLargeError extends Error {}
class InvalidBodyEncodingError extends Error {}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function isJsonContentType(request: Request): boolean {
  return (
    request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() ===
    "application/json"
  );
}

async function readBoundedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      throw new BodyTooLargeError();
    }
  }

  if (request.body === null) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body);
  } catch {
    throw new InvalidBodyEncodingError();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  const allowedKeys = new Set(keys);
  return actualKeys.length === keys.length && actualKeys.every((key) => allowedKeys.has(key));
}

function isExactSecond(value: unknown): value is string {
  if (typeof value !== "string" || !exactSecondPattern.test(value)) {
    return false;
  }

  const parsed = new Date(value);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString() === value.replace(/Z$/, ".000Z")
  );
}

function isNormalizedSlot(value: unknown): value is string {
  return (
    isExactSecond(value) &&
    normalizedSlotPattern.test(value) &&
    Number(value.slice(14, 16)) % 5 === 3
  );
}

function parseCheck(value: unknown): IngestPayload["checks"][number] | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "component",
      "checkedAt",
      "result",
      "latencyMs",
      "httpStatus",
      "failureCode",
    ])
  ) {
    return null;
  }

  if (value.component !== "web" && value.component !== "api") {
    return null;
  }
  if (!isExactSecond(value.checkedAt)) {
    return null;
  }
  if (value.result !== "up" && value.result !== "down") {
    return null;
  }
  if (
    !Number.isInteger(value.latencyMs) ||
    (value.latencyMs as number) < 0 ||
    (value.latencyMs as number) > 120_000
  ) {
    return null;
  }
  if (
    value.httpStatus !== null &&
    (!Number.isInteger(value.httpStatus) ||
      (value.httpStatus as number) < 100 ||
      (value.httpStatus as number) > 599)
  ) {
    return null;
  }
  if (
    value.failureCode !== null &&
    (typeof value.failureCode !== "string" ||
      !failureCodes.has(value.failureCode as FailureCode))
  ) {
    return null;
  }
  if (
    (value.result === "up" && value.failureCode !== null) ||
    (value.result === "down" && value.failureCode === null)
  ) {
    return null;
  }

  return value as IngestPayload["checks"][number];
}

function parsePayload(rawBody: string): IngestPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "scheduledAt", "sentAt", "checks"]) ||
    value.version !== 1 ||
    !isNormalizedSlot(value.scheduledAt) ||
    !isExactSecond(value.sentAt) ||
    !Array.isArray(value.checks) ||
    value.checks.length !== 2
  ) {
    return null;
  }

  const checks = value.checks.map(parseCheck);
  if (checks.some((check) => check === null)) {
    return null;
  }

  const typedChecks = checks as IngestPayload["checks"];
  const components = new Set(typedChecks.map((check) => check.component));
  if (!components.has("web") || !components.has("api")) {
    return null;
  }

  return {
    version: 1,
    scheduledAt: value.scheduledAt,
    sentAt: value.sentAt,
    checks: typedChecks,
  };
}

function sentAtMatchesTimestamp(sentAt: string, timestamp: string): boolean {
  return String(new Date(sentAt).getTime() / 1_000) === timestamp;
}

function toSample(
  scheduledAt: string,
  check: IngestPayload["checks"][number],
): CheckSample {
  return { ...check, scheduledAt };
}

export function createWorker(options: WorkerOptions = {}): ExportedHandler<Env> & {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
} {
  const now = options.now ?? (() => new Date());
  const storeFactory = options.storeFactory ?? createD1StatusStore;

  return {
    async fetch(request, env): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname !== "/api/checks") {
        return env.ASSETS.fetch(request);
      }
      if (request.method !== "POST") {
        return textResponse("method not allowed", 405);
      }
      if (!isJsonContentType(request)) {
        return textResponse("unsupported media type", 415);
      }

      let rawBody: string;
      try {
        rawBody = await readBoundedBody(request);
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          return textResponse("payload too large", 413);
        }
        return textResponse("invalid request", 400);
      }

      if (!env.STATUS_INGEST_SECRET) {
        console.error("status ingestion is unavailable");
        return textResponse("temporarily unavailable", 503);
      }

      const timestamp = request.headers.get("X-Status-Timestamp") ?? "";
      const signature = request.headers.get("X-Status-Signature") ?? "";
      const requestNow = now();
      const signatureIsValid = await verifySignedBody({
        secret: env.STATUS_INGEST_SECRET,
        timestamp,
        rawBody,
        signature,
        now: requestNow,
      });
      if (!signatureIsValid) {
        return textResponse("unauthorized", 401);
      }

      const payload = parsePayload(rawBody);
      if (payload === null) {
        return textResponse("invalid request", 400);
      }
      if (!sentAtMatchesTimestamp(payload.sentAt, timestamp)) {
        return textResponse("unauthorized", 401);
      }

      try {
        const store = storeFactory(env.DB);
        for (const check of payload.checks) {
          await store.insertSample(toSample(payload.scheduledAt, check));
        }
        await store.deleteExpiredSamples(
          new Date(requestNow.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1_000),
          RETENTION_BATCH_SIZE,
        );
      } catch {
        console.error("status ingestion failed");
        return textResponse("temporarily unavailable", 503);
      }

      return new Response(null, { status: 204 });
    },
  };
}

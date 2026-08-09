import { signBody } from "../../worker/signature";
import { checkApi, checkWeb, isoSecond, type MonitorCheck } from "./checks";

const INGEST_ENDPOINT = "https://status.palate.one/api/checks";
const FIRST_SLOT_MINUTE = 3;
const DELIVERY_TIMEOUT_MS = 10_000;

export type SendChecksInput = {
  endpoint: string;
  secret: string;
  scheduledAt: string;
  checks: MonitorCheck[];
  now: Date;
  fetcher?: typeof fetch;
};

export type RunMonitorInput = {
  endpoint: string;
  secret: string;
  startedAt: Date;
  sentAt?: () => Date;
  fetcher?: typeof fetch;
  writeSummary?: (summary: string) => Promise<void>;
};

type BunRuntime = {
  env: Record<string, string | undefined>;
  write(path: string, data: string): Promise<number>;
};

function assertIngestionConfiguration(endpoint: string, secret: string): void {
  if (endpoint !== INGEST_ENDPOINT || secret.length === 0) {
    throw new Error("invalid ingestion configuration");
  }
}

export function scheduledSlot(now: Date): string {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("invalid schedule time");
  }

  const hourStart = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
  );
  const minute = now.getUTCMinutes();
  const slotMs =
    minute < FIRST_SLOT_MINUTE
      ? hourStart - 2 * 60 * 1_000
      : hourStart +
        (FIRST_SLOT_MINUTE +
          Math.floor((minute - FIRST_SLOT_MINUTE) / 5) * 5) *
          60 *
          1_000;

  return isoSecond(new Date(slotMs));
}

function validateChecks(checks: MonitorCheck[]): void {
  const components = new Set(checks.map(({ component }) => component));
  if (
    checks.length !== 2 ||
    components.size !== 2 ||
    !components.has("web") ||
    !components.has("api")
  ) {
    throw new Error("invalid monitor checks");
  }
}

export async function sendChecks(input: SendChecksInput): Promise<void> {
  assertIngestionConfiguration(input.endpoint, input.secret);
  validateChecks(input.checks);

  const sentAt = isoSecond(input.now);
  const timestamp = String(Date.parse(sentAt) / 1_000);
  const rawBody = JSON.stringify({
    version: 1,
    scheduledAt: input.scheduledAt,
    sentAt,
    checks: input.checks,
  });
  const signature = await signBody(input.secret, timestamp, rawBody);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const response = await (input.fetcher ?? fetch)(input.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Status-Timestamp": timestamp,
        "X-Status-Signature": signature,
      },
      body: rawBody,
    });
    if (!response.ok) {
      throw new Error("status ingestion failed");
    }
  } catch {
    throw new Error("status ingestion failed");
  } finally {
    clearTimeout(timeout);
  }
}

function summaryFor(checks: MonitorCheck[], scheduledAt: string): string {
  const rows = checks.map((check) => {
    const label = check.component === "web" ? "Web" : "API";
    const result = check.result === "up" ? "정상" : "실패";
    const status = check.httpStatus === null ? "-" : String(check.httpStatus);
    const failure = check.failureCode ?? "-";
    return `| ${label} | ${result} | ${status} | ${check.latencyMs}ms | ${failure} |`;
  });

  return [
    "## Status monitor",
    "",
    `Scheduled slot: ${scheduledAt}`,
    "",
    "| Component | Result | HTTP | Latency | Failure code |",
    "| --- | --- | ---: | ---: | --- |",
    ...rows,
    "",
  ].join("\n");
}

async function writeGitHubSummary(summary: string): Promise<void> {
  const bun = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;
  const path = bun?.env.GITHUB_STEP_SUMMARY;
  if (bun === undefined || path === undefined || path === "") {
    return;
  }
  await bun.write(path, summary);
}

export async function runMonitor(input: RunMonitorInput): Promise<void> {
  assertIngestionConfiguration(input.endpoint, input.secret);
  const fetcher = input.fetcher ?? fetch;
  const scheduledAt = scheduledSlot(input.startedAt);
  const checks = await Promise.all([
    checkWeb(fetcher, input.startedAt),
    checkApi(fetcher, input.startedAt),
  ]);

  let ingestionFailed = false;
  try {
    await sendChecks({
      endpoint: input.endpoint,
      secret: input.secret,
      scheduledAt,
      checks,
      now: (input.sentAt ?? (() => new Date()))(),
      fetcher,
    });
  } catch {
    ingestionFailed = true;
  }

  await (input.writeSummary ?? writeGitHubSummary)(summaryFor(checks, scheduledAt));

  if (ingestionFailed) {
    throw new Error("status ingestion failed");
  }
  if (checks.some(({ result }) => result === "down")) {
    throw new Error("one or more status checks failed");
  }
}

async function main(): Promise<void> {
  const bun = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;
  if (bun === undefined) {
    throw new Error("Bun runtime required");
  }

  await runMonitor({
    endpoint: bun.env.STATUS_INGEST_URL ?? "",
    secret: bun.env.STATUS_INGEST_SECRET ?? "",
    startedAt: new Date(),
  });
}

if ((import.meta as ImportMeta & { main?: boolean }).main) {
  void main().catch(() => {
    console.error("status monitor failed");
    const runtimeProcess = (
      globalThis as typeof globalThis & { process?: { exitCode?: number } }
    ).process;
    if (runtimeProcess !== undefined) {
      runtimeProcess.exitCode = 1;
    }
  });
}

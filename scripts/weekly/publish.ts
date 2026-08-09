import type { PublicStatusResponse } from "../../worker/read";
import {
  weeklyUptimeSchema,
  type WeeklyUptimeDocument,
} from "../../src/status/content-schema";
import { calculateUptime } from "../../src/status/uptime";

const DAY_MS = 24 * 60 * 60 * 1_000;
const WEEK_MS = 7 * DAY_MS;
export const PUBLIC_STATUS_ENDPOINT = "https://status.palate.one/api/status";
const COMPONENT_ORDER = ["web", "api"] as const;

export type IsoWeekRange = {
  week: string;
  from: string;
  to: string;
};

export type PublishWeeklyOptions = {
  now?: Date;
  root?: string;
  fetcher?: typeof fetch;
};

type DailyUptimePoint = PublicStatusResponse["components"][number]["days"][number];
type PublicComponent = PublicStatusResponse["components"][number];
type FileStat = {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
};
type FsPromises = {
  link(oldPath: string, newPath: string): Promise<void>;
  lstat(path: string): Promise<FileStat>;
  mkdir(path: string, options: { recursive: boolean }): Promise<string | undefined>;
  unlink(path: string): Promise<void>;
  writeFile(
    path: string,
    data: string,
    options: { encoding: "utf8"; flag: "wx"; mode: number },
  ): Promise<void>;
};

async function fsPromises(): Promise<FsPromises> {
  const moduleSpecifier = "node:fs/promises";
  return (await import(moduleSpecifier)) as unknown as FsPromises;
}

function joinPath(root: string, relativePath: string): string {
  return `${root.replace(/\/+$/, "")}/${relativePath}`;
}

function currentWorkingDirectory(): string {
  const runtimeProcess = (
    globalThis as typeof globalThis & { process?: { cwd?: () => string } }
  ).process;
  return runtimeProcess?.cwd?.() ?? ".";
}

function randomIdentifier(): string {
  const runtimeCrypto = (
    globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } }
  ).crypto;
  return runtimeCrypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatIsoSecond(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(".000Z", "Z");
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function parseRfc3339(value: unknown, name: string): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    throw new Error(`invalid ${name}`);
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null) {
    throw new Error(`invalid ${name}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const maxDay = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (
    maxDay === undefined ||
    day < 1 ||
    day > maxDay ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new Error(`invalid ${name}`);
  }

  const offset = match[7];
  if (offset !== "Z") {
    const offsetHours = Number(offset.slice(1, 3));
    const offsetMinutes = Number(offset.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) {
      throw new Error(`invalid ${name}`);
    }
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`invalid ${name}`);
  }
  return timestamp;
}

function isoWeekForMonday(timestamp: number): string {
  const monday = new Date(timestamp);
  const mondayStart = Date.UTC(
    monday.getUTCFullYear(),
    monday.getUTCMonth(),
    monday.getUTCDate(),
  );
  const thursday = new Date(mondayStart + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const januaryFourth = Date.UTC(isoYear, 0, 4);
  const januaryFourthDay = new Date(januaryFourth).getUTCDay() || 7;
  const firstMonday = januaryFourth - (januaryFourthDay - 1) * DAY_MS;
  const week = Math.floor((mondayStart - firstMonday) / WEEK_MS) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function assertWeekRange(range: IsoWeekRange): void {
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(range.week)) {
    throw new Error(`invalid ISO week: ${range.week}`);
  }

  const from = parseRfc3339(range.from, "week start");
  const to = parseRfc3339(range.to, "week end");
  const fromDate = new Date(from);
  if (
    to - from !== WEEK_MS ||
    fromDate.getUTCHours() !== 0 ||
    fromDate.getUTCMinutes() !== 0 ||
    fromDate.getUTCSeconds() !== 0 ||
    fromDate.getUTCMilliseconds() !== 0
  ) {
    throw new Error("ISO week range must cover seven UTC days");
  }
  if (new Date(from).getUTCDay() !== 1 || isoWeekForMonday(from) !== range.week) {
    throw new Error("ISO week range does not match its week");
  }
}

export function previousIsoWeek(now: Date): IsoWeekRange {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("invalid current time");
  }

  const todayStart = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const day = new Date(todayStart).getUTCDay() || 7;
  const thisMonday = todayStart - (day - 1) * DAY_MS;
  const from = thisMonday - WEEK_MS;
  const range = {
    week: isoWeekForMonday(from),
    from: formatIsoSecond(from),
    to: formatIsoSecond(thisMonday),
  };
  assertWeekRange(range);
  return range;
}

export function weeklyPath(range: IsoWeekRange): `content/uptime/${string}.json` {
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(range.week)) {
    throw new Error(`invalid ISO week: ${range.week}`);
  }
  return `content/uptime/${range.week}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isUtcDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function assertPublicStatusResponse(value: unknown): asserts value is PublicStatusResponse {
  if (!isRecord(value)) {
    throw new Error("invalid public status response");
  }
  parseRfc3339(value.generatedAt, "generatedAt");
  if (value.monitoringStartedAt !== null) {
    parseRfc3339(value.monitoringStartedAt, "monitoringStartedAt");
  }
  if (
    value.overall !== "operational" &&
    value.overall !== "service_disruption" &&
    value.overall !== "verification_unavailable"
  ) {
    throw new Error("invalid public status response");
  }
  if (!Array.isArray(value.components) || value.components.length !== COMPONENT_ORDER.length) {
    throw new Error("invalid public status response");
  }

  const components = new Map<string, PublicComponent>();
  for (const component of value.components) {
    if (!isRecord(component) || (component.id !== "web" && component.id !== "api")) {
      throw new Error("invalid public status response");
    }
    if (components.has(component.id)) {
      throw new Error("invalid public status response");
    }
    if (
      (component.id === "web" && component.label !== "Web") ||
      (component.id === "api" && component.label !== "API") ||
      typeof component.status !== "string" ||
      !["operational", "outage", "unknown"].includes(component.status) ||
      !Array.isArray(component.days)
    ) {
      throw new Error("invalid public status response");
    }
    if (component.lastCheckedAt !== null) {
      parseRfc3339(component.lastCheckedAt, "lastCheckedAt");
    }
    if (component.lastSuccessAt !== null) {
      parseRfc3339(component.lastSuccessAt, "lastSuccessAt");
    }
    if (
      (component.uptime30d !== null && !isPercentage(component.uptime30d)) ||
      !isPercentage(component.coverage30d)
    ) {
      throw new Error("invalid public status response");
    }

    const days = new Set<string>();
    for (const day of component.days) {
      if (
        !isRecord(day) ||
        !isUtcDay(day.day) ||
        days.has(day.day) ||
        !isCount(day.upSamples) ||
        !isCount(day.downSamples) ||
        !isCount(day.expectedSamples) ||
        day.upSamples + day.downSamples > day.expectedSamples ||
        (day.uptimePercent !== null && !isPercentage(day.uptimePercent)) ||
        !isPercentage(day.coveragePercent)
      ) {
        throw new Error("invalid public status response");
      }
      days.add(day.day);
    }
    components.set(component.id, component as PublicComponent);
  }
  if (!components.has("web") || !components.has("api")) {
    throw new Error("invalid public status response");
  }
}

function dayRange(range: IsoWeekRange): string[] {
  const from = parseRfc3339(range.from, "week start");
  return Array.from({ length: 7 }, (_, index) =>
    new Date(from + index * DAY_MS).toISOString().slice(0, 10),
  );
}

function aggregateComponent(
  component: PublicComponent,
  dates: readonly string[],
  monitoringStartedAt: number,
): WeeklyUptimeDocument["components"][number] {
  const points = new Map<string, DailyUptimePoint>();
  for (const point of component.days) {
    if (dates.includes(point.day)) {
      points.set(point.day, point);
    }
  }

  let upSamples = 0;
  let downSamples = 0;
  let expectedSamples = 0;
  for (const day of dates) {
    const dayStart = Date.parse(`${day}T00:00:00Z`);
    const dayEndsAfterLaunch = dayStart + DAY_MS > monitoringStartedAt;
    const point = points.get(day);
    if (!dayEndsAfterLaunch) {
      continue;
    }
    if (point === undefined) {
      throw new Error(`missing daily aggregate for ${component.id} on ${day}`);
    }
    upSamples += point.upSamples;
    downSamples += point.downSamples;
    expectedSamples += point.expectedSamples;
  }

  const calculated = calculateUptime({ upSamples, downSamples, expectedSamples });
  return {
    id: component.id,
    upSamples,
    downSamples,
    expectedSamples,
    uptimePercent: calculated.uptimePercent,
    coveragePercent: calculated.coveragePercent,
  };
}

export function buildWeeklyDocument(
  status: PublicStatusResponse,
  range: IsoWeekRange,
): WeeklyUptimeDocument {
  assertWeekRange(range);
  assertPublicStatusResponse(status);
  if (status.monitoringStartedAt === null) {
    throw new Error("monitoring start is unavailable; cannot publish weekly uptime");
  }
  const monitoringStartedAt = parseRfc3339(status.monitoringStartedAt, "monitoringStartedAt");
  const dates = dayRange(range);
  const componentsById = new Map(status.components.map((component) => [component.id, component]));
  const document: WeeklyUptimeDocument = {
    schemaVersion: 1,
    week: range.week,
    from: range.from,
    to: range.to,
    generatedAt: status.generatedAt,
    monitoringStartedAt: status.monitoringStartedAt,
    components: COMPONENT_ORDER.map((id) => aggregateComponent(componentsById.get(id)!, dates, monitoringStartedAt)),
  };
  weeklyUptimeSchema.parse(document);
  return document;
}

export async function fetchPublicStatus(
  fetcher: typeof fetch = fetch,
): Promise<PublicStatusResponse> {
  let response: Response;
  try {
    response = await fetcher(PUBLIC_STATUS_ENDPOINT, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("public status request failed");
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("public status request failed");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("invalid public status response");
  }
  assertPublicStatusResponse(payload);
  return payload;
}

function serializedDocument(document: WeeklyUptimeDocument): string {
  weeklyUptimeSchema.parse(document);
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function assertArchiveDirectory(fs: FsPromises, path: string): Promise<void> {
  const stat = await fs.lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("archive directory must be a real directory inside the root");
  }
}

export async function writeWeeklyArchive(
  document: WeeklyUptimeDocument,
  root = currentWorkingDirectory(),
): Promise<`content/uptime/${string}.json`> {
  weeklyUptimeSchema.parse(document);
  const range: IsoWeekRange = {
    week: document.week,
    from: document.from,
    to: document.to,
  };
  assertWeekRange(range);
  const relativePath = weeklyPath(range);
  const fs = await fsPromises();
  const target = joinPath(root, relativePath);
  const directory = target.slice(0, target.lastIndexOf("/"));
  const contentDirectory = joinPath(root, "content");
  await assertArchiveDirectory(fs, root);
  await fs.mkdir(contentDirectory, { recursive: true });
  await assertArchiveDirectory(fs, contentDirectory);
  await fs.mkdir(directory, { recursive: true });
  await assertArchiveDirectory(fs, directory);

  const temporary = `${directory}/.${document.week}.${randomIdentifier()}.tmp`;
  const contents = serializedDocument(document);
  try {
    await fs.writeFile(temporary, contents, { encoding: "utf8", flag: "wx", mode: 0o644 });
    try {
      await fs.link(temporary, target);
    } catch (error) {
      if ((error as { code?: string }).code === "EEXIST") {
        throw new Error(`weekly archive already exists: ${relativePath}`);
      }
      throw error;
    }
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }

  return relativePath;
}

export async function publishWeekly(options: PublishWeeklyOptions = {}): Promise<{
  range: IsoWeekRange;
  document: WeeklyUptimeDocument;
  path: `content/uptime/${string}.json`;
}> {
  const range = previousIsoWeek(options.now ?? new Date());
  const status = await fetchPublicStatus(options.fetcher);
  const document = buildWeeklyDocument(status, range);
  const path = await writeWeeklyArchive(document, options.root);
  return { range, document, path };
}

async function main(): Promise<void> {
  const result = await publishWeekly();
  console.log(result.path);
}

if ((import.meta as ImportMeta & { main?: boolean }).main) {
  void main().catch(() => {
    console.error("weekly uptime publish failed");
    const runtimeProcess = (
      globalThis as typeof globalThis & { process?: { exitCode?: number } }
    ).process;
    if (runtimeProcess !== undefined) {
      runtimeProcess.exitCode = 1;
    }
  });
}

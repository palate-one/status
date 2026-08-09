import type {
  AggregateInput,
  ExpectedSlotInput,
  UptimeResult,
} from "./types";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function roundPercentage(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

export function calculateUptime(input: AggregateInput): UptimeResult {
  assertCount("upSamples", input.upSamples);
  assertCount("downSamples", input.downSamples);
  assertCount("expectedSamples", input.expectedSamples);

  const observedSamples = input.upSamples + input.downSamples;
  if (observedSamples > input.expectedSamples) {
    throw new RangeError("observed samples cannot exceed expected samples");
  }

  return {
    observedSamples,
    uptimePercent:
      observedSamples === 0
        ? null
        : roundPercentage((input.upSamples / observedSamples) * 100),
    coveragePercent:
      input.expectedSamples === 0
        ? 0
        : roundPercentage((observedSamples / input.expectedSamples) * 100),
  };
}

function parseDay(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) {
    throw new RangeError(`invalid UTC day: ${day}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const dayStart = Date.UTC(year, month - 1, date);
  const parsed = new Date(dayStart);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== date
  ) {
    throw new RangeError(`invalid UTC day: ${day}`);
  }

  return dayStart;
}

function scheduledSlots(dayStart: number): number[] {
  const slots: number[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 3; minute < 60; minute += 5) {
      slots.push(dayStart + (hour * 60 + minute) * MINUTE_MS);
    }
  }
  return slots;
}

export function expectedSlotsForDay(input: ExpectedSlotInput): number {
  const dayStart = parseDay(input.day);
  const monitoringStartedAt = Date.parse(input.monitoringStartedAt);
  if (!Number.isFinite(monitoringStartedAt)) {
    throw new RangeError(`invalid monitoring start: ${input.monitoringStartedAt}`);
  }

  const nowMs = input.now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("invalid current time");
  }

  const todayStart = Date.UTC(
    input.now.getUTCFullYear(),
    input.now.getUTCMonth(),
    input.now.getUTCDate(),
  );
  if (dayStart > todayStart || dayStart + DAY_MS <= monitoringStartedAt) {
    return 0;
  }

  const end = dayStart === todayStart ? nowMs : dayStart + DAY_MS - 1;
  return scheduledSlots(dayStart).filter(
    (slot) => slot >= monitoringStartedAt && slot <= end,
  ).length;
}

import { z, type ZodType } from "astro/zod";

export type ComponentId = "web" | "api";
export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";
export type IncidentSeverity = "degraded" | "partial_outage" | "major_outage";
export type MaintenanceStatus = "scheduled" | "in_progress" | "completed" | "cancelled";

export type IncidentFrontmatter = {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  components: ComponentId[];
  startedAt: string;
  resolvedAt: string | null;
};

export type MaintenanceFrontmatter = {
  id: string;
  title: string;
  status: MaintenanceStatus;
  components: ComponentId[];
  startsAt: string;
  endsAt: string | null;
};

export type WeeklyUptimeDocument = {
  schemaVersion: 1;
  week: string;
  from: string;
  to: string;
  generatedAt: string;
  monitoringStartedAt: string;
  components: Array<{
    id: ComponentId;
    upSamples: number;
    downSamples: number;
    expectedSamples: number;
    uptimePercent: number | null;
    coveragePercent: number;
  }>;
};

const componentId = z.enum(["web", "api"]);
const incidentId = z.string().regex(/^inc-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
const maintenanceId = z.string().regex(/^maint-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
const isoWeek = z.string().regex(/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/);

const rfc3339Pattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isRfc3339(value: string): boolean {
  const match = rfc3339Pattern.exec(value);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const maxDay = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

  if (
    !maxDay ||
    day < 1 ||
    day > maxDay ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }

  if (offset !== "Z") {
    const offsetHours = Number(offset.slice(1, 3));
    const offsetMinutes = Number(offset.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59 || (offsetHours === 23 && offsetMinutes > 59)) {
      return false;
    }
  }

  return Number.isFinite(Date.parse(value));
}

const rfc3339 = z.string().refine(isRfc3339, {
  message: "Expected an RFC 3339 timestamp with a timezone",
});

function timestamp(value: string): number {
  return Date.parse(value);
}

function isoWeekForTimestamp(value: string): string {
  const date = new Date(timestamp(value));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function validateResolvedIncident(
  value: IncidentFrontmatter,
  context: Parameters<NonNullable<Parameters<typeof incidentSchema.superRefine>[0]>>[1],
): void {
  const hasResolvedAt = value.resolvedAt !== null;
  if (value.status === "resolved" && !hasResolvedAt) {
    context.addIssue({
      code: "custom",
      path: ["resolvedAt"],
      message: "Resolved incidents must include resolvedAt",
    });
  }
  if (value.status !== "resolved" && hasResolvedAt) {
    context.addIssue({
      code: "custom",
      path: ["resolvedAt"],
      message: "Only resolved incidents may include resolvedAt",
    });
  }
  if (value.resolvedAt && timestamp(value.resolvedAt) < timestamp(value.startedAt)) {
    context.addIssue({
      code: "custom",
      path: ["resolvedAt"],
      message: "resolvedAt must be after startedAt",
    });
  }
}

export const incidentSchema: ZodType<IncidentFrontmatter> = z
  .object({
    id: incidentId,
    title: z.string().min(1).max(120),
    status: z.enum(["investigating", "identified", "monitoring", "resolved"]),
    severity: z.enum(["degraded", "partial_outage", "major_outage"]),
    components: z.array(componentId).min(1),
    startedAt: rfc3339,
    resolvedAt: rfc3339.nullable(),
  })
  .strict()
  .superRefine(validateResolvedIncident);

function validateMaintenance(
  value: MaintenanceFrontmatter,
  context: Parameters<NonNullable<Parameters<typeof maintenanceSchema.superRefine>[0]>>[1],
): void {
  if (value.endsAt !== null && timestamp(value.endsAt) <= timestamp(value.startsAt)) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "endsAt must be after startsAt",
    });
  }
  if (value.status === "completed" && value.endsAt === null) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "Completed maintenance must include endsAt",
    });
  }
}

export const maintenanceSchema: ZodType<MaintenanceFrontmatter> = z
  .object({
    id: maintenanceId,
    title: z.string().min(1).max(120),
    status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]),
    components: z.array(componentId).min(1),
    startsAt: rfc3339,
    endsAt: rfc3339.nullable(),
  })
  .strict()
  .superRefine(validateMaintenance);

const sampleCount = z.number().int().nonnegative();
const percentage = z.number().finite().min(0).max(100);

export const weeklyUptimeSchema: ZodType<WeeklyUptimeDocument> = z
  .object({
    schemaVersion: z.literal(1),
    week: isoWeek,
    from: rfc3339,
    to: rfc3339,
    generatedAt: rfc3339,
    monitoringStartedAt: rfc3339,
    components: z
      .array(
        z
          .object({
            id: componentId,
            upSamples: sampleCount,
            downSamples: sampleCount,
            expectedSamples: sampleCount,
            uptimePercent: percentage.nullable(),
            coveragePercent: percentage,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (timestamp(value.to) <= timestamp(value.from)) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "to must be after from",
      });
    }
    if (isoWeekForTimestamp(value.from) !== value.week) {
      context.addIssue({
        code: "custom",
        path: ["week"],
        message: "week must agree with from",
      });
    }
    for (const [index, component] of value.components.entries()) {
      if (component.upSamples + component.downSamples > component.expectedSamples) {
        context.addIssue({
          code: "custom",
          path: ["components", index, "expectedSamples"],
          message: "observed samples cannot exceed expected samples",
        });
      }
    }
  });

export function weeklyFilenameMatchesWeek(filename: string, week: string): boolean {
  const basename = filename.split(/[\\/]/).pop() ?? "";
  return basename === `${week}.json` && isoWeek.safeParse(week).success;
}

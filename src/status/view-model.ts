import type { IncidentFrontmatter, MaintenanceFrontmatter } from "./content-schema";
import type { DailyUptimePoint, PublicStatusResponse } from "../../worker/read";
import type { ComponentId, PublicComponentStatus } from "./types";

const STALE_AFTER_MS = 15 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export type StatusContentEntry<T> = {
  id?: string;
  data: T;
  body?: string;
  filePath?: string;
};

export type DailyUptimeViewModel = DailyUptimePoint & {
  dateLabel: string;
  uptimeLabel: string;
  coverageLabel: string;
  ariaLabel: string;
};

export type ComponentStatusViewModel = {
  id: ComponentId;
  label: "Web" | "API";
  status: PublicComponentStatus;
  statusLabel: "정상" | "문제 발생" | "상태 확인 불가";
  uptimeLabel: string;
  coverageLabel: string;
  lastCheckedLabel: string;
  days: DailyUptimeViewModel[];
};

export type StatusViewModel = {
  overallStatus: PublicStatusResponse["overall"];
  overallLabel: "모든 시스템 정상" | "서비스 문제 발생" | "상태 확인 불가";
  lastCheckedLabel: string;
  isStale: boolean;
  components: ComponentStatusViewModel[];
  activeIncidents: StatusContentEntry<IncidentFrontmatter>[];
  scheduledMaintenance: StatusContentEntry<MaintenanceFrontmatter>[];
  incidentHistory: StatusContentEntry<IncidentFrontmatter>[];
  maintenanceHistory: StatusContentEntry<MaintenanceFrontmatter>[];
  resolvedHistory: Array<
    | StatusContentEntry<IncidentFrontmatter>
    | StatusContentEntry<MaintenanceFrontmatter>
  >;
};

export type StatusContent = {
  incidents?: readonly StatusContentEntry<IncidentFrontmatter>[];
  maintenance?: readonly StatusContentEntry<MaintenanceFrontmatter>[];
};

export function statusLabel(
  status: PublicComponentStatus,
): "정상" | "문제 발생" | "상태 확인 불가" {
  switch (status) {
    case "operational":
      return "정상";
    case "outage":
      return "문제 발생";
    default:
      return "상태 확인 불가";
  }
}
function roundPercent(value: number): number {
  return Number(value.toFixed(2));
}

export function formatUptime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "측정 데이터 없음";
  }

  const rounded = roundPercent(value);
  return `${String(rounded)}%`;
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return Number.NaN;
  }
  return Date.parse(value);
}

function sortByTimestamp<T>(entries: readonly T[], read: (entry: T) => string | null | undefined): T[] {
  return [...entries].sort((left, right) => {
    const leftTime = parseTimestamp(read(left));
    const rightTime = parseTimestamp(read(right));
    if (leftTime === rightTime) {
      return 0;
    }
    if (!Number.isFinite(leftTime)) {
      return 1;
    }
    if (!Number.isFinite(rightTime)) {
      return -1;
    }
    return rightTime - leftTime;
  });
}

type IncidentEntry = {
  data: Pick<IncidentFrontmatter, "status" | "startedAt"> & Partial<IncidentFrontmatter>;
};

export function sortIncidents<T extends IncidentEntry>(entries: readonly T[]): T[] {
  return sortByTimestamp(entries, (entry) => entry.data.startedAt);
}

export function sortIncidentHistory<T extends IncidentEntry>(entries: readonly T[]): T[] {
  return sortHistory(entries, (entry) => entry.data.resolvedAt ?? entry.data.startedAt);
}

type MaintenanceEntry = {
  data: Pick<MaintenanceFrontmatter, "status" | "startsAt"> & Partial<MaintenanceFrontmatter>;
};

const maintenanceOrder: Record<MaintenanceEntry["data"]["status"], number> = {
  in_progress: 0,
  scheduled: 1,
  completed: 2,
  cancelled: 3,
};

export function sortMaintenance<T extends MaintenanceEntry>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) => {
    const leftRank = maintenanceOrder[left.data.status];
    const rightRank = maintenanceOrder[right.data.status];
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const leftTime = parseTimestamp(left.data.startsAt);
    const rightTime = parseTimestamp(right.data.startsAt);
    if (leftTime === rightTime) {
      return 0;
    }
    if (!Number.isFinite(leftTime)) {
      return 1;
    }
    if (!Number.isFinite(rightTime)) {
      return -1;
    }
    return leftTime - rightTime;
  });
}

export function sortMaintenanceHistory<T extends MaintenanceEntry>(entries: readonly T[]): T[] {
  return sortHistory(entries, (entry) => entry.data.endsAt ?? entry.data.startsAt);
}

function sortHistory<T>(
  entries: readonly T[],
  read: (entry: T) => string | null | undefined,
): T[] {
  return sortByTimestamp(entries, read);
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "측정 데이터 없음";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "상태 확인 불가";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function overallLabel(
  status: PublicStatusResponse["overall"],
): StatusViewModel["overallLabel"] {
  switch (status) {
    case "operational":
      return "모든 시스템 정상";
    case "service_disruption":
      return "서비스 문제 발생";
    default:
      return "상태 확인 불가";
  }
}

function isNoData(component: PublicStatusResponse["components"][number]): boolean {
  return component.lastCheckedAt === null && component.uptime30d === null;
}

function isResponseStale(response: PublicStatusResponse, now: Date): boolean {
  const generatedAt = parseTimestamp(response.generatedAt);
  const current = now.getTime();
  return (
    !Number.isFinite(generatedAt) ||
    !Number.isFinite(current) ||
    current - generatedAt > STALE_AFTER_MS
  );
}

function viewDays(days: readonly DailyUptimePoint[]): DailyUptimeViewModel[] {
  return days.map((day) => {
    const dateLabel = formatDate(day.day);
    const uptimeLabel = formatUptime(day.uptimePercent);
    const coverageLabel = formatUptime(day.coveragePercent);
    return {
      ...day,
      dateLabel,
      uptimeLabel,
      coverageLabel,
      ariaLabel: `${dateLabel}, 가동률 ${uptimeLabel}, 정상 ${day.upSamples}회, 문제 ${day.downSamples}회, 측정 범위 ${coverageLabel}`,
    };
  });
}

export function buildThirtyDayUptimeRail(
  days: readonly DailyUptimePoint[],
  now: Date,
): DailyUptimeViewModel[] {
  if (!Number.isFinite(now.getTime())) {
    return viewDays(days);
  }

  const todayStart = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const byDay = new Map(days.map((day) => [day.day, day]));
  const projected: DailyUptimePoint[] = [];

  for (let offset = 29; offset >= 0; offset -= 1) {
    const day = new Date(todayStart - offset * DAY_MS).toISOString().slice(0, 10);
    projected.push(
      byDay.get(day) ?? {
        day,
        upSamples: 0,
        downSamples: 0,
        expectedSamples: 0,
        uptimePercent: null,
        coveragePercent: 0,
      },
    );
  }

  return viewDays(projected);
}

export function toStatusViewModel(
  response: PublicStatusResponse,
  now: Date,
  content: StatusContent = {},
): StatusViewModel {
  const isStale = isResponseStale(response, now);
  const components = response.components.map((component) => {
    const noData = isNoData(component);
    const status = isStale || noData ? "unknown" : component.status;
    return {
      id: component.id,
      label: component.label,
      status,
      statusLabel: statusLabel(status),
      uptimeLabel: formatUptime(component.uptime30d),
      coverageLabel: formatUptime(component.coverage30d),
      lastCheckedLabel: formatDateTime(component.lastCheckedAt),
      days: buildThirtyDayUptimeRail(component.days, now),
    } satisfies ComponentStatusViewModel;
  });

  const hasNoData = components.length === 0 || components.every(({ status }) => status === "unknown") &&
    response.components.every(isNoData);
  let computedOverall: PublicStatusResponse["overall"] = response.overall;
  if (isStale || hasNoData) {
    computedOverall = "verification_unavailable";
  } else if (components.some(({ status }) => status === "outage")) {
    computedOverall = "service_disruption";
  } else if (components.some(({ status }) => status === "unknown")) {
    computedOverall = "verification_unavailable";
  }

  const incidents = sortIncidents(content.incidents ?? []);
  const maintenance = sortMaintenance(content.maintenance ?? []);
  const activeIncidents = incidents.filter(({ data }) => data.status !== "resolved");
  const incidentHistory = sortHistory(
    incidents.filter(({ data }) => data.status === "resolved"),
    ({ data }) => data.resolvedAt ?? data.startedAt,
  );
  const scheduledMaintenance = maintenance.filter(({ data }) =>
    data.status === "scheduled" || data.status === "in_progress",
  );
  const maintenanceHistory = sortHistory(
    maintenance.filter(({ data }) => data.status === "completed" || data.status === "cancelled"),
    ({ data }) => data.endsAt ?? data.startsAt,
  );
  const latestCheckedAt = response.components
    .map(({ lastCheckedAt }) => lastCheckedAt)
    .filter((value): value is string => value !== null)
    .sort((left, right) => parseTimestamp(right) - parseTimestamp(left))[0] ?? null;

  return {
    overallStatus: computedOverall,
    overallLabel: overallLabel(computedOverall),
    lastCheckedLabel: isStale
      ? "마지막 관측이 15분 이상 지났어요"
      : formatDateTime(latestCheckedAt),
    isStale,
    components,
    activeIncidents,
    scheduledMaintenance,
    incidentHistory,
    maintenanceHistory,
    resolvedHistory: [...incidentHistory, ...maintenanceHistory],
  };
}

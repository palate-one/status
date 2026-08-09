import { derivePublicState } from "../src/status/state";
import type {
  ComponentId,
  ComponentState,
  PublicComponentStatus,
} from "../src/status/types";
import { calculateUptime, expectedSlotsForDay } from "../src/status/uptime";
import type { Env } from "./env";
import { createWorker as createIngestWorker } from "./ingest";
import { createD1StatusStore, type DailyAggregateRow, type StatusSnapshot, type StatusStore } from "./store";

const DAY_MS = 24 * 60 * 60 * 1_000;
const COMPONENTS = ["web", "api"] as const satisfies readonly ComponentId[];
const componentLabels = {
  web: "Web",
  api: "API",
} as const;

export type DailyUptimePoint = {
  day: string;
  upSamples: number;
  downSamples: number;
  expectedSamples: number;
  uptimePercent: number | null;
  coveragePercent: number;
};

export type PublicStatusResponse = {
  generatedAt: string;
  monitoringStartedAt: string | null;
  overall: "operational" | "service_disruption" | "verification_unavailable";
  components: Array<{
    id: ComponentId;
    label: "Web" | "API";
    status: PublicComponentStatus;
    lastCheckedAt: string | null;
    lastSuccessAt: string | null;
    uptime30d: number | null;
    coverage30d: number;
    days: DailyUptimePoint[];
  }>;
};

export type PublicStatusWorkerOptions = {
  now?: () => Date;
  storeFactory?: (db: D1Database) => StatusStore;
};

function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function graphDays(monitoringStartedAt: string | null, now: Date): string[] {
  if (monitoringStartedAt === null) {
    return [];
  }

  const todayStart = dayStart(utcDay(now));
  const monitoringDayStart = dayStart(monitoringStartedAt.slice(0, 10));
  const firstDayStart = Math.max(monitoringDayStart, todayStart - 29 * DAY_MS);
  if (!Number.isFinite(monitoringDayStart) || firstDayStart > todayStart) {
    return [];
  }

  const days: string[] = [];
  for (let current = firstDayStart; current <= todayStart; current += DAY_MS) {
    days.push(new Date(current).toISOString().slice(0, 10));
  }
  return days;
}

function aggregateKey(component: ComponentId, day: string): string {
  return `${component}:${day}`;
}

function dailyRowsByComponentAndDay(
  rows: DailyAggregateRow[],
): Map<string, DailyAggregateRow> {
  return new Map(rows.map((row) => [aggregateKey(row.component, row.day), row]));
}

function unknownState(component: ComponentId): ComponentState {
  return {
    component,
    status: "unknown",
    consecutiveFailures: 0,
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
  };
}

function overallStatus(
  statuses: PublicComponentStatus[],
): PublicStatusResponse["overall"] {
  if (statuses.includes("outage")) {
    return "service_disruption";
  }
  if (statuses.includes("unknown")) {
    return "verification_unavailable";
  }
  return "operational";
}

export function projectPublicStatus(
  snapshot: StatusSnapshot,
  now: Date,
): PublicStatusResponse {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("invalid current time");
  }

  const days = graphDays(snapshot.monitoringStartedAt, now);
  const dailyRows = dailyRowsByComponentAndDay(snapshot.daily);
  const states = new Map(snapshot.states.map((state) => [state.component, state]));

  const components = COMPONENTS.map((component) => {
    const state = derivePublicState(states.get(component) ?? unknownState(component), now);
    const points = days.map((day): DailyUptimePoint => {
      const aggregate = dailyRows.get(aggregateKey(component, day));
      const upSamples = aggregate?.upSamples ?? 0;
      const downSamples = aggregate?.downSamples ?? 0;
      const expectedSamples = expectedSlotsForDay({
        day,
        monitoringStartedAt: snapshot.monitoringStartedAt as string,
        now,
      });
      const calculated = calculateUptime({
        upSamples,
        downSamples,
        expectedSamples,
      });

      return {
        day,
        upSamples,
        downSamples,
        expectedSamples,
        uptimePercent: calculated.uptimePercent,
        coveragePercent: calculated.coveragePercent,
      };
    });

    const totals = points.reduce(
      (total, point) => ({
        upSamples: total.upSamples + point.upSamples,
        downSamples: total.downSamples + point.downSamples,
        expectedSamples: total.expectedSamples + point.expectedSamples,
      }),
      { upSamples: 0, downSamples: 0, expectedSamples: 0 },
    );
    const uptime = calculateUptime(totals);

    return {
      id: component,
      label: componentLabels[component],
      status: state.status,
      lastCheckedAt: state.lastCheckedAt,
      lastSuccessAt: state.lastSuccessAt,
      uptime30d: uptime.uptimePercent,
      coverage30d: uptime.coveragePercent,
      days: points,
    };
  });

  return {
    generatedAt: now.toISOString(),
    monitoringStartedAt: snapshot.monitoringStartedAt,
    overall: overallStatus(components.map(({ status }) => status)),
    components,
  };
}

function methodNotAllowed(allow: "GET" | "POST"): Response {
  return new Response("method not allowed", {
    status: 405,
    headers: {
      Allow: allow,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function publicStatusResponse(body: PublicStatusResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function createPublicStatusWorker(
  options: PublicStatusWorkerOptions = {},
): ExportedHandler<Env> & {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
} {
  const now = options.now ?? (() => new Date());
  const storeFactory = options.storeFactory ?? createD1StatusStore;
  const ingestWorker = createIngestWorker({ now, storeFactory });

  return {
    async fetch(request, env, ctx): Promise<Response> {
      const pathname = new URL(request.url).pathname;

      if (pathname === "/api/status") {
        if (request.method !== "GET") {
          return methodNotAllowed("GET");
        }

        try {
          const generatedAt = now();
          const snapshot = await storeFactory(env.DB).readStatus(generatedAt);
          return publicStatusResponse(projectPublicStatus(snapshot, generatedAt));
        } catch {
          console.error("public status read failed");
          return new Response("temporarily unavailable", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      }

      if (pathname === "/api/checks") {
        if (request.method !== "POST") {
          return methodNotAllowed("POST");
        }
        return ingestWorker.fetch(request, env, ctx);
      }

      if (pathname === "/api" || pathname.startsWith("/api/")) {
        return new Response("not found", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      return env.ASSETS.fetch(request);
    },
  };
}

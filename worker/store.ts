import type {
  CheckSample,
  ComponentId,
  ComponentState,
  PublicComponentStatus,
} from "../src/status/types";

export type DailyAggregateRow = {
  day: string;
  component: ComponentId;
  upSamples: number;
  downSamples: number;
  storedExpectedSamples: number;
  firstScheduledAt: string;
  lastScheduledAt: string;
};

export type StatusSnapshot = {
  monitoringStartedAt: string | null;
  states: ComponentState[];
  daily: DailyAggregateRow[];
};

export type StatusStore = {
  insertSamples(samples: readonly CheckSample[]): Promise<{ inserted: number }>;
  readStatus(now: Date): Promise<StatusSnapshot>;
  deleteExpiredSamples(cutoff: Date, limit: number): Promise<number>;
};

type StateRow = {
  component: ComponentId;
  status: PublicComponentStatus;
  consecutive_failures: number;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
};

type DailyRow = {
  day: string;
  component: ComponentId;
  up_samples: number;
  down_samples: number;
  expected_samples: number;
  first_scheduled_at: string;
  last_scheduled_at: string;
};

type MonitoringRow = {
  monitoring_started_at: string | null;
};

function assertValidDate(name: string, value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw new RangeError(`${name} must be a valid date`);
  }
  return value.toISOString();
}

function assertRetentionLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError("retention limit must be an integer between 1 and 1000");
  }
}

function statusWindow(nowIso: string): { startDay: string; endDay: string } {
  const endDay = nowIso.slice(0, 10);
  const endDayStart = Date.parse(`${endDay}T00:00:00Z`);
  const startDay = new Date(endDayStart - 29 * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
  return { startDay, endDay };
}

function mapState(row: StateRow): ComponentState {
  return {
    component: row.component,
    status: row.status,
    consecutiveFailures: row.consecutive_failures,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
  };
}

function mapDaily(row: DailyRow): DailyAggregateRow {
  return {
    day: row.day,
    component: row.component,
    upSamples: row.up_samples,
    downSamples: row.down_samples,
    storedExpectedSamples: row.expected_samples,
    firstScheduledAt: row.first_scheduled_at,
    lastScheduledAt: row.last_scheduled_at,
  };
}

export function createD1StatusStore(db: D1Database): StatusStore {
  return {
    async insertSamples(samples: readonly CheckSample[]): Promise<{ inserted: number }> {
      if (samples.length < 1 || samples.length > 2) {
        throw new RangeError("sample batch must contain one or two samples");
      }

      const statement = db.prepare(`
        INSERT INTO check_samples (
          component,
          scheduled_at,
          checked_at,
          result,
          latency_ms,
          http_status,
          failure_code
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT (component, scheduled_at) DO NOTHING
        RETURNING id
      `);
      const results = await db.batch(
        samples.map((sample) =>
          statement.bind(
            sample.component,
            sample.scheduledAt,
            sample.checkedAt,
            sample.result,
            sample.latencyMs,
            sample.httpStatus,
            sample.failureCode,
          ),
        ),
      );

      return {
        inserted: results.reduce((total, result) => total + result.results.length, 0),
      };
    },

    async readStatus(now: Date): Promise<StatusSnapshot> {
      const nowIso = assertValidDate("now", now);
      const { startDay, endDay } = statusWindow(nowIso);

      const [stateResult, dailyResult, monitoringResult] = await db.batch([
        db.prepare(`
          SELECT
            component,
            status,
            consecutive_failures,
            last_checked_at,
            last_success_at,
            last_failure_at
          FROM component_state
          ORDER BY component
        `),
        db.prepare(`
          SELECT
            day,
            component,
            up_samples,
            down_samples,
            expected_samples,
            first_scheduled_at,
            last_scheduled_at
          FROM daily_uptime
          WHERE day BETWEEN ?1 AND ?2
          ORDER BY day, component
        `).bind(startDay, endDay),
        db.prepare(`
          SELECT monitoring_started_at
          FROM status_metadata
          WHERE id = 1
        `),
      ]);

      const monitoring = monitoringResult.results[0] as MonitoringRow | undefined;
      return {
        monitoringStartedAt: monitoring?.monitoring_started_at ?? null,
        states: (stateResult.results as StateRow[]).map(mapState),
        daily: (dailyResult.results as DailyRow[]).map(mapDaily),
      };
    },

    async deleteExpiredSamples(cutoff: Date, limit: number): Promise<number> {
      const cutoffIso = assertValidDate("cutoff", cutoff);
      assertRetentionLimit(limit);

      const result = await db
        .prepare(`
          DELETE FROM check_samples
          WHERE id IN (
            SELECT id
            FROM check_samples
            WHERE checked_at < ?1
            ORDER BY checked_at, id
            LIMIT ?2
          )
        `)
        .bind(cutoffIso, limit)
        .run();

      return result.meta.changes;
    },
  };
}

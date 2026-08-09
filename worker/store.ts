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
  insertSample(sample: CheckSample): Promise<{ inserted: boolean }>;
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
    async insertSample(sample: CheckSample): Promise<{ inserted: boolean }> {
      const inserted = await db
        .prepare(`
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
        `)
        .bind(
          sample.component,
          sample.scheduledAt,
          sample.checkedAt,
          sample.result,
          sample.latencyMs,
          sample.httpStatus,
          sample.failureCode,
        )
        .first<{ id: number }>();

      return { inserted: inserted !== null };
    },

    async readStatus(now: Date): Promise<StatusSnapshot> {
      assertValidDate("now", now);

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
          ORDER BY day, component
        `),
        db.prepare(`
          SELECT MIN(first_scheduled_at) AS monitoring_started_at
          FROM daily_uptime
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

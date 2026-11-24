import { checkApi, checkWeb, isoSecond } from "./checks";
import type { Env } from "./env";
import { formatNotification, notificationFor, sendTelegram } from "./notify";
import { createD1StatusStore, type StatusStore } from "./store";

const RETENTION_DAYS = 35;
const RETENTION_BATCH_SIZE = 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MINUTE_MS = 60_000;

export type MonitorOptions = {
  now?: () => Date;
  fetcher?: typeof fetch;
  storeFactory?: (db: D1Database) => StatusStore;
};

/** Cron이 시작한 한 시각의 Web·API 관측을 저장하고, 장애와 복구로 바뀔 때만 알린다. */
export async function runScheduledChecks(
  scheduledTime: number,
  env: Env,
  options: MonitorOptions = {},
): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const now = (options.now ?? (() => new Date()))();
  const store = (options.storeFactory ?? createD1StatusStore)(env.DB);
  // D1은 초가 00인 시각만 받는다.
  const scheduledAt = isoSecond(new Date(Math.floor(scheduledTime / MINUTE_MS) * MINUTE_MS));

  const checks = await Promise.all([checkWeb(fetcher, now), checkApi(fetcher, now)]);
  const { before, after } = await store.insertSamples(
    checks.map((check) => ({ ...check, scheduledAt })),
  );

  for (const check of checks) {
    const kind = notificationFor(check.component, before, after);
    if (kind !== null) {
      await sendTelegram(formatNotification(kind, check), env, fetcher);
    }
  }

  try {
    await store.deleteExpiredSamples(
      new Date(now.getTime() - RETENTION_DAYS * DAY_MS),
      RETENTION_BATCH_SIZE,
    );
  } catch {
    console.error("status retention failed");
  }
}

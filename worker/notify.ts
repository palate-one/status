import type { ComponentId, ComponentState } from "../src/status/types";
import type { MonitorCheck } from "./checks";
import type { Env } from "./env";

const TELEGRAM_TIMEOUT_MS = 10_000;
const componentNames = { web: "palate.one Web", api: "api.palate.one API" } as const;

export type NotificationKind = "down" | "recovered";

function statusOf(component: ComponentId, states: readonly ComponentState[]) {
  return states.find((state) => state.component === component)?.status;
}

/** 장애가 이어지는 동안에는 다시 알리지 않는다. */
export function notificationFor(
  component: ComponentId,
  before: readonly ComponentState[],
  after: readonly ComponentState[],
): NotificationKind | null {
  const previous = statusOf(component, before);
  const current = statusOf(component, after);
  if (current === "outage" && previous !== "outage") return "down";
  if (current === "operational" && previous === "outage") return "recovered";
  return null;
}

export function formatNotification(kind: NotificationKind, check: MonitorCheck): string {
  const name = componentNames[check.component];
  if (kind === "recovered") {
    return `🟢 ${name}가 복구됐어요\n\n확인 시각: ${check.checkedAt}`;
  }
  const reason = check.httpStatus === null ? check.failureCode : `HTTP ${check.httpStatus}`;
  return `🔴 ${name}가 응답하지 않아요\n\n- ${reason}\n\n확인 시각: ${check.checkedAt}`;
}

/** 알림 실패가 관측 저장을 막지 않는다. 응답 본문에는 bot token이 섞일 수 있어 기록하지 않는다. */
export async function sendTelegram(
  text: string,
  env: Env,
  fetcher: typeof fetch,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.warn("telegram is not configured");
    return;
  }
  try {
    const response = await fetcher(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      console.error(`telegram returned HTTP ${response.status}`);
    }
  } catch {
    console.error("telegram request failed");
  }
}

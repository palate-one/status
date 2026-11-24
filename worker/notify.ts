import type { ComponentId, ComponentState } from "../src/status/types";
import type { MonitorCheck } from "./checks";
import type { Env } from "./env";

const TELEGRAM_TIMEOUT_MS = 10_000;
const STATUS_PAGE = "https://status.palate.one/";
const componentNames = { web: "palate.one", api: "api.palate.one" } as const;

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
    return `🟢 ${name} 복구\n\n확인 시각: ${check.checkedAt}\n${STATUS_PAGE}`;
  }
  // 본문 불일치는 상태 코드가 200이어도 실패다.
  const reason =
    check.failureCode === "http_status" ? `HTTP ${check.httpStatus}` : check.failureCode;
  return `🔴 ${name} 응답 이상\n\n- ${reason}\n\n확인 시각: ${check.checkedAt}\n${STATUS_PAGE}`;
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
    await response.body?.cancel();
    if (!response.ok) {
      console.error(`telegram returned HTTP ${response.status}`);
    }
  } catch {
    console.error("telegram request failed");
  }
}

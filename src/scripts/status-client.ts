import { toStatusViewModel, type ComponentStatusViewModel, type DailyUptimeViewModel, type StatusViewModel } from "../status/view-model";
import type { PublicStatusResponse } from "../../worker/read";

const publicStatuses = new Set(["operational", "outage", "unknown"]);
const overallStatuses = new Set(["operational", "service_disruption", "verification_unavailable"]);
const STALE_AFTER_MS = 15 * 60 * 1_000;
const UPTIME_RAIL_LENGTH = 30;
const staleCancellations = new WeakMap<ParentNode, () => void>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isPublicStatusResponse(value: unknown): value is PublicStatusResponse {
  if (
    !isRecord(value) ||
    !isTimestamp(value.generatedAt) ||
    !overallStatuses.has(String(value.overall))
  ) {
    return false;
  }
  if (value.monitoringStartedAt !== null && !isTimestamp(value.monitoringStartedAt)) {
    return false;
  }
  if (!Array.isArray(value.components) || value.components.length !== 2) {
    return false;
  }

  const componentIds = new Set<string>();
  const componentsAreValid = value.components.every((component) => {
    if (!isRecord(component)) return false;
    if (component.id !== "web" && component.id !== "api") return false;
    if (componentIds.has(component.id)) return false;
    componentIds.add(component.id);
    if (
      (component.id === "web" && component.label !== "Web") ||
      (component.id === "api" && component.label !== "API")
    ) {
      return false;
    }
    if (typeof component.status !== "string" || !publicStatuses.has(component.status)) return false;
    if (component.lastCheckedAt !== null && !isTimestamp(component.lastCheckedAt)) return false;
    if (component.lastSuccessAt !== null && !isTimestamp(component.lastSuccessAt)) return false;
    if (component.uptime30d !== null && !isPercentage(component.uptime30d)) return false;
    if (!isPercentage(component.coverage30d) || !Array.isArray(component.days)) return false;
    if (component.days.length > 30) return false;
    return component.days.every((day) => {
      if (!isRecord(day) || typeof day.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.day)) {
        return false;
      }
      return (
        isCount(day.upSamples) &&
        isCount(day.downSamples) &&
        isCount(day.expectedSamples) &&
        day.upSamples + day.downSamples <= day.expectedSamples &&
        (day.uptimePercent === null || isPercentage(day.uptimePercent)) &&
        isPercentage(day.coveragePercent)
      );
    });
  });

  return componentsAreValid && componentIds.has("web") && componentIds.has("api");
}

export type StaleTransitionOptions = {
  now?: () => Date;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
};

export function scheduleStaleTransition(
  response: PublicStatusResponse,
  render: (model: StatusViewModel) => void,
  options: StaleTransitionOptions = {},
): () => void {
  const now = options.now ?? (() => new Date());
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  const currentMs = now().getTime();
  const generatedAtMs = Date.parse(response.generatedAt);
  if (
    !Number.isFinite(currentMs) ||
    !Number.isFinite(generatedAtMs) ||
    currentMs - generatedAtMs > STALE_AFTER_MS
  ) {
    return () => undefined;
  }

  let active = true;
  const delayMs = generatedAtMs + STALE_AFTER_MS - currentMs + 1;
  const handle = schedule(() => {
    if (!active) return;
    active = false;
    render(toStatusViewModel(response, now()));
  }, delayMs);

  return () => {
    if (!active) return;
    active = false;
    cancel(handle);
  };
}

function statusMark(status: ComponentStatusViewModel["status"] | PublicStatusResponse["overall"]): string {
  return status === "operational" ? "✓" : status === "outage" || status === "service_disruption" ? "!" : "?";
}

function updateStateClass(element: HTMLElement, status: string): void {
  element.classList.remove("status-operational", "status-outage", "status-unknown", "status-service_disruption", "status-verification_unavailable");
  element.classList.add(`status-${status}`);
}

function updateOverall(root: ParentNode, model: StatusViewModel): void {
  const overall = root.querySelector<HTMLElement>("[data-overall-status]");
  if (!overall) return;
  overall.dataset.overallState = model.overallStatus;
  updateStateClass(overall, model.overallStatus);
  const mark = overall.querySelector<HTMLElement>("[data-overall-mark]");
  if (mark) mark.textContent = statusMark(model.overallStatus);
  const label = overall.querySelector<HTMLElement>("[data-overall-label]");
  if (label) label.textContent = model.overallLabel;
  overall.querySelector<HTMLElement>(".overall-state")?.setAttribute(
    "aria-label",
    `서비스 전체 상태: ${model.overallLabel}`,
  );
  const lastChecked = overall.querySelector<HTMLElement>("[data-overall-last-checked]");
  if (lastChecked) lastChecked.textContent = `마지막 관측 · ${model.lastCheckedLabel}`;
}

function updateComponent(root: ParentNode, component: ComponentStatusViewModel): void {
  const element = root.querySelector<HTMLElement>(`[data-component-id="${component.id}"]`);
  if (!element) return;
  element.dataset.componentState = component.status;
  updateStateClass(element, component.status);
  const mark = element.querySelector<HTMLElement>("[data-component-mark]");
  if (mark) mark.textContent = statusMark(component.status);
  const label = element.querySelector<HTMLElement>("[data-component-status-label]");
  if (label) label.textContent = component.statusLabel;
  const uptime = element.querySelector<HTMLElement>("[data-component-uptime]");
  if (uptime) uptime.textContent = component.uptimeLabel;
  const coverage = element.querySelector<HTMLElement>("[data-component-coverage]");
  if (coverage) coverage.textContent = component.coverageLabel;
  const lastChecked = element.querySelector<HTMLElement>("[data-component-last-checked]");
  if (lastChecked) lastChecked.textContent = component.lastCheckedLabel;
  const stateLabel = element.querySelector<HTMLElement>("[data-component-state-label]");
  if (stateLabel) stateLabel.setAttribute("aria-label", `${component.label} 상태: ${component.statusLabel}`);
}

function renderPlaceholderDays(list: HTMLOListElement): void {
  const document = list.ownerDocument;
  const placeholders = Array.from({ length: UPTIME_RAIL_LENGTH }, () => {
    const item = document.createElement("li");
    item.className = "uptime-day is-placeholder";
    item.dataset.uptimePlaceholder = "";
    item.setAttribute("aria-hidden", "true");
    return item;
  });
  const unavailable = document.createElement("li");
  unavailable.className = "uptime-empty-label sr-only";
  unavailable.textContent = "측정 데이터 없음";
  list.replaceChildren(...placeholders, unavailable);
}

function renderDays(list: HTMLOListElement, days: readonly DailyUptimeViewModel[]): void {
  const document = list.ownerDocument;
  if (days.length === 0) {
    renderPlaceholderDays(list);
    return;
  }

  const items = days.map((day) => {
    const item = document.createElement("li");
    item.className = `uptime-day ${day.uptimePercent === null ? "is-empty" : day.downSamples > 0 ? "has-down" : "is-up"}`;
    item.dataset.uptimeDay = day.day;
    item.setAttribute("aria-label", day.ariaLabel);
    item.title = day.ariaLabel;

    const mark = document.createElement("span");
    mark.className = "day-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = day.uptimePercent === null ? "—" : day.downSamples > 0 ? "!" : "✓";
    item.appendChild(mark);
    return item;
  });
  list.replaceChildren(...items);
}

function updateUptime(root: ParentNode, component: ComponentStatusViewModel): void {
  const list = root.querySelector<HTMLOListElement>(`[data-uptime-component="${component.label.toLowerCase()}"] [data-uptime-list]`);
  if (list) renderDays(list, component.days);
}

function renderUnavailable(root: ParentNode): void {
  const overall = root.querySelector<HTMLElement>("[data-overall-status]");
  if (overall) {
    overall.dataset.overallState = "verification_unavailable";
    updateStateClass(overall, "verification_unavailable");
    const mark = overall.querySelector<HTMLElement>("[data-overall-mark]");
    if (mark) mark.textContent = "?";
    const label = overall.querySelector<HTMLElement>("[data-overall-label]");
    if (label) label.textContent = "상태 확인 불가";
    overall.querySelector<HTMLElement>(".overall-state")?.setAttribute(
      "aria-label",
      "서비스 전체 상태: 상태 확인 불가",
    );
    const lastChecked = overall.querySelector<HTMLElement>("[data-overall-last-checked]");
    if (lastChecked) lastChecked.textContent = "마지막 관측 · 다시 확인해 주세요";
  }

  root.querySelectorAll<HTMLElement>("[data-component-id]").forEach((element) => {
    element.dataset.componentState = "unknown";
    updateStateClass(element, "unknown");
    const mark = element.querySelector<HTMLElement>("[data-component-mark]");
    if (mark) mark.textContent = "?";
    const label = element.querySelector<HTMLElement>("[data-component-status-label]");
    if (label) label.textContent = "상태 확인 불가";
    const lastChecked = element.querySelector<HTMLElement>("[data-component-last-checked]");
    if (lastChecked) lastChecked.textContent = "상태 확인 불가";
  });

  root.querySelectorAll<HTMLOListElement>("[data-uptime-list]").forEach((list) => {
    renderPlaceholderDays(list);
  });
}

export function renderStatusModel(root: ParentNode, model: StatusViewModel): void {
  updateOverall(root, model);
  model.components.forEach((component) => {
    updateComponent(root, component);
    updateUptime(root, component);
  });
  const page = root.querySelector<HTMLElement>("[data-status-page]");
  if (page) page.setAttribute("aria-busy", "false");
}

export async function hydrateStatus(
  fetcher: typeof fetch = window.fetch.bind(window),
  root: ParentNode = document,
): Promise<void> {
  staleCancellations.get(root)?.();
  staleCancellations.delete(root);

  try {
    const response = await fetcher("/api/status", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("status request failed");
    const payload: unknown = await response.json();
    if (!isPublicStatusResponse(payload)) throw new Error("invalid status response");
    renderStatusModel(root, toStatusViewModel(payload, new Date()));
    const cancelStaleTransition = scheduleStaleTransition(payload, (model) => {
      staleCancellations.delete(root);
      renderStatusModel(root, model);
    });
    staleCancellations.set(root, cancelStaleTransition);
  } catch {
    renderUnavailable(root);
    const page = root.querySelector<HTMLElement>("[data-status-page]");
    if (page) page.setAttribute("aria-busy", "false");
  }
}

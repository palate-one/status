import { toStatusViewModel, type ComponentStatusViewModel, type DailyUptimeViewModel, type StatusViewModel } from "../status/view-model";
import type { PublicStatusResponse } from "../../worker/read";

const publicStatuses = new Set(["operational", "outage", "unknown"]);
const overallStatuses = new Set(["operational", "service_disruption", "verification_unavailable"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPublicStatusResponse(value: unknown): value is PublicStatusResponse {
  if (!isRecord(value) || typeof value.generatedAt !== "string" || !overallStatuses.has(String(value.overall))) {
    return false;
  }
  if (value.monitoringStartedAt !== null && typeof value.monitoringStartedAt !== "string") {
    return false;
  }
  if (!Array.isArray(value.components)) {
    return false;
  }
  return value.components.every((component) => {
    if (!isRecord(component)) return false;
    if (component.id !== "web" && component.id !== "api") return false;
    if (component.label !== "Web" && component.label !== "API") return false;
    if (typeof component.status !== "string" || !publicStatuses.has(component.status)) return false;
    if (component.lastCheckedAt !== null && typeof component.lastCheckedAt !== "string") return false;
    if (component.lastSuccessAt !== null && typeof component.lastSuccessAt !== "string") return false;
    if (component.uptime30d !== null && typeof component.uptime30d !== "number") return false;
    if (typeof component.coverage30d !== "number" || !Array.isArray(component.days)) return false;
    return component.days.every((day) => {
      if (!isRecord(day) || typeof day.day !== "string") return false;
      return (
        typeof day.upSamples === "number" &&
        typeof day.downSamples === "number" &&
        typeof day.expectedSamples === "number" &&
        (day.uptimePercent === null || typeof day.uptimePercent === "number") &&
        typeof day.coveragePercent === "number"
      );
    });
  });
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

function renderDays(list: HTMLOListElement, days: readonly DailyUptimeViewModel[]): void {
  const document = list.ownerDocument;
  if (days.length === 0) {
    list.replaceChildren(Object.assign(document.createElement("li"), {
      className: "empty-day",
      textContent: "측정 데이터 없음",
    }));
    return;
  }

  const items = days.map((day) => {
    const item = document.createElement("li");
    item.className = `uptime-day ${day.uptimePercent === null ? "is-empty" : day.downSamples > 0 ? "has-down" : "is-up"}`;
    item.dataset.uptimeDay = day.day;
    item.setAttribute("aria-label", day.ariaLabel);

    const mark = document.createElement("span");
    mark.className = "day-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = day.uptimePercent === null ? "—" : day.downSamples > 0 ? "!" : "✓";
    const date = document.createElement("span");
    date.className = "day-label";
    date.textContent = day.dateLabel;
    const counts = document.createElement("span");
    counts.className = "day-counts";
    counts.textContent = `${day.upSamples}↑ · ${day.downSamples}↓`;
    const coverage = document.createElement("span");
    coverage.className = "day-coverage";
    coverage.textContent = day.coverageLabel;
    item.appendChild(mark);
    item.appendChild(date);
    item.appendChild(counts);
    item.appendChild(coverage);
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
  try {
    const response = await fetcher("/api/status", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("status request failed");
    const payload: unknown = await response.json();
    if (!isPublicStatusResponse(payload)) throw new Error("invalid status response");
    renderStatusModel(root, toStatusViewModel(payload, new Date()));
  } catch {
    renderUnavailable(root);
    const page = root.querySelector<HTMLElement>("[data-status-page]");
    if (page) page.setAttribute("aria-busy", "false");
  }
}

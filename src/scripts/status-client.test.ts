import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublicStatusResponse } from "../../worker/read";
import {
  hydrateStatus,
  isPublicStatusResponse,
  renderStatusModel,
  scheduleStaleTransition,
} from "./status-client";
import { toStatusViewModel } from "../status/view-model";

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }
}

class FakeElement {
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly ownerDocument: FakeDocument;
  className = "";
  textContent = "";
  title = "";
  parent: FakeElement | null = null;
  readonly classList = {
    add: (...names: string[]) => {
      this.className = [...new Set([...this.className.split(" "), ...names].filter(Boolean))].join(" ");
    },
    remove: (...names: string[]) => {
      this.className = this.className
        .split(" ")
        .filter((name) => name && !names.includes(name))
        .join(" ");
    },
  };

  constructor(ownerDocument: FakeDocument, readonly tagName: string) {
    this.ownerDocument = ownerDocument;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  querySelector<T extends FakeElement = FakeElement>(selector: string): T | null {
    return this.querySelectorAll<T>(selector)[0] ?? null;
  }

  querySelectorAll<T extends FakeElement = FakeElement>(selector: string): T[] {
    const matches: T[] = [];
    const visit = (element: FakeElement) => {
      if (element.matches(selector)) matches.push(element as T);
      element.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }

  private matches(selector: string): boolean {
    const parts = selector.trim().split(/\s+/);
    const last = parts.at(-1);
    if (!last || !this.matchesSimple(last)) return false;
    let ancestor = this.parent;
    for (let index = parts.length - 2; index >= 0; index -= 1) {
      while (ancestor && !ancestor.matchesSimple(parts[index])) {
        ancestor = ancestor.parent;
      }
      if (!ancestor) return false;
      ancestor = ancestor.parent;
    }
    return true;
  }

  private matchesSimple(selector: string): boolean {
    if (selector.startsWith(".")) {
      return this.className.split(" ").includes(selector.slice(1));
    }
    const match = selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
    if (!match) return false;
    const key = match[1].replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return key in this.dataset && (match[2] === undefined || this.dataset[key] === match[2]);
  }
}

function createRoot(): { root: FakeElement; lists: FakeElement[] } {
  const document = new FakeDocument();
  const root = document.createElement("document");
  const page = document.createElement("main");
  page.dataset.statusPage = "";
  root.appendChild(page);

  const overall = document.createElement("section");
  overall.dataset.overallStatus = "";
  overall.dataset.overallState = "verification_unavailable";
  const overallState = document.createElement("div");
  overallState.className = "overall-state";
  const overallMark = document.createElement("span");
  overallMark.dataset.overallMark = "";
  const overallLabel = document.createElement("span");
  overallLabel.dataset.overallLabel = "";
  const overallLastChecked = document.createElement("p");
  overallLastChecked.dataset.overallLastChecked = "";
  overallState.appendChild(overallMark);
  overallState.appendChild(overallLabel);
  overall.appendChild(overallState);
  overall.appendChild(overallLastChecked);
  page.appendChild(overall);

  const lists: FakeElement[] = [];
  for (const [id, label] of [["web", "Web"], ["api", "API"]] as const) {
    const component = document.createElement("article");
    component.dataset.componentId = id;
    component.dataset.componentState = "unknown";
    const stateLabel = document.createElement("p");
    stateLabel.dataset.componentStateLabel = "";
    const mark = document.createElement("span");
    mark.dataset.componentMark = "";
    const statusLabel = document.createElement("span");
    statusLabel.dataset.componentStatusLabel = "";
    stateLabel.appendChild(mark);
    stateLabel.appendChild(statusLabel);
    const uptime = document.createElement("dd");
    uptime.dataset.componentUptime = "";
    const coverage = document.createElement("dd");
    coverage.dataset.componentCoverage = "";
    const lastChecked = document.createElement("dd");
    lastChecked.dataset.componentLastChecked = "";
    component.appendChild(stateLabel);
    component.appendChild(uptime);
    component.appendChild(coverage);
    component.appendChild(lastChecked);
    const block = document.createElement("section");
    block.dataset.uptimeComponent = label.toLowerCase();
    const list = document.createElement("ol");
    list.dataset.uptimeList = "";
    block.appendChild(list);
    component.appendChild(block);
    page.appendChild(component);
    lists.push(list);
  }

  return { root, lists };
}

function response(): PublicStatusResponse {
  return {
    generatedAt: "2026-08-09T12:00:00Z",
    monitoringStartedAt: "2026-08-01T00:03:00Z",
    overall: "operational",
    components: [
      {
        id: "web",
        label: "Web",
        status: "operational",
        lastCheckedAt: "2026-08-09T12:00:00Z",
        lastSuccessAt: "2026-08-09T12:00:00Z",
        uptime30d: 100,
        coverage30d: 100,
        days: [],
      },
      {
        id: "api",
        label: "API",
        status: "operational",
        lastCheckedAt: "2026-08-09T12:00:00Z",
        lastSuccessAt: "2026-08-09T12:00:00Z",
        uptime30d: 100,
        coverage30d: 100,
        days: [],
      },
    ],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("public status response validation", () => {
  it("requires exactly one correctly paired Web and API component", () => {
    const valid = response();
    const cases: Array<[string, PublicStatusResponse]> = [
      ["empty", { ...valid, components: [] }],
      ["single", { ...valid, components: valid.components.slice(0, 1) }],
      ["duplicate", { ...valid, components: [valid.components[0], valid.components[0]] }],
      [
        "mismatched label",
        {
          ...valid,
          components: [{ ...valid.components[0], label: "API" }, valid.components[1]],
        },
      ],
    ];

    expect(isPublicStatusResponse(valid)).toBe(true);
    for (const [_case, payload] of cases) {
      expect(isPublicStatusResponse(payload)).toBe(false);
    }
  });
});

describe("uptime rail hydration", () => {
  it("renders 30 compact day segments and restores placeholders on unavailable fallback", async () => {
    const hydrated = createRoot();
    renderStatusModel(
      hydrated.root as unknown as ParentNode,
      toStatusViewModel(response(), new Date("2026-08-09T12:20:00Z")),
    );

    for (const list of hydrated.lists) {
      expect(list.children).toHaveLength(30);
      expect(list.children.every((day) => day.dataset.uptimeDay && day.title)).toBe(true);
      expect(list.children.every((day) => day.querySelector(".day-label") === null)).toBe(true);
    }

    const unavailable = createRoot();
    await hydrateStatus(async () => {
      throw new Error("offline");
    }, unavailable.root as unknown as ParentNode);

    for (const list of unavailable.lists) {
      const placeholders = list.children.filter((day) => "uptimePlaceholder" in day.dataset);
      expect(placeholders).toHaveLength(30);
      expect(placeholders.every((day) => day.getAttribute("aria-hidden") === "true")).toBe(true);
    }
  });
});

describe("long-lived status tabs", () => {
  it("transitions to unknown only after the strict 15-minute boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:00:00Z"));
    const render = vi.fn();

    const cancel = scheduleStaleTransition(response(), render);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1_000);
    expect(render).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][0].overallStatus).toBe("verification_unavailable");
    expect(
      render.mock.calls[0][0].components.every(
        ({ status }: { status: string }) => status === "unknown",
      ),
    ).toBe(true);

    cancel();
  });

  it("can cancel a pending stale transition", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:00:00Z"));
    const render = vi.fn();

    const cancel = scheduleStaleTransition(response(), render);
    cancel();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1_000 + 1);

    expect(render).not.toHaveBeenCalled();
  });
});

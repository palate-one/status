import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { PublicStatusResponse } from "../../worker/read";
import {
  buildWeeklyDocument,
  fetchPublicStatus,
  previousIsoWeek,
  publishWeekly,
  weeklyPath,
  writeWeeklyArchive,
} from "./publish";

const RANGE = {
  week: "2026-W32",
  from: "2026-08-03T00:00:00Z",
  to: "2026-08-10T00:00:00Z",
} as const;

const WEEK_DAYS = [
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-08",
  "2026-08-09",
];

function point(
  day: string,
  overrides: Partial<PublicStatusResponse["components"][number]["days"][number]> = {},
): PublicStatusResponse["components"][number]["days"][number] {
  return {
    day,
    upSamples: 288,
    downSamples: 0,
    expectedSamples: 288,
    uptimePercent: 100,
    coveragePercent: 100,
    ...overrides,
  };
}

function statusResponse(
  overrides: Partial<PublicStatusResponse> = {},
): PublicStatusResponse {
  return {
    generatedAt: "2026-08-10T00:17:00Z",
    monitoringStartedAt: "2026-08-01T00:03:00Z",
    overall: "operational",
    components: [
      {
        id: "web",
        label: "Web",
        status: "operational",
        lastCheckedAt: "2026-08-10T00:13:00Z",
        lastSuccessAt: "2026-08-10T00:13:00Z",
        uptime30d: 100,
        coverage30d: 100,
        days: WEEK_DAYS.map((day) => point(day)),
      },
      {
        id: "api",
        label: "API",
        status: "operational",
        lastCheckedAt: "2026-08-10T00:13:00Z",
        lastSuccessAt: "2026-08-10T00:13:00Z",
        uptime30d: 100,
        coverage30d: 100,
        days: WEEK_DAYS.map((day) => point(day)),
      },
    ],
    ...overrides,
  };
}

describe("previous ISO week", () => {
  it("handles a year crossover without losing the final ISO week", () => {
    expect(previousIsoWeek(new Date("2021-01-04T00:17:00Z"))).toEqual({
      week: "2020-W53",
      from: "2020-12-28T00:00:00Z",
      to: "2021-01-04T00:00:00Z",
    });
  });

  it("handles a leap-year February boundary", () => {
    expect(previousIsoWeek(new Date("2024-03-04T00:17:00Z"))).toEqual({
      week: "2024-W09",
      from: "2024-02-26T00:00:00Z",
      to: "2024-03-04T00:00:00Z",
    });
  });
});

describe("weekly document projection", () => {
  it("aggregates exactly the seven UTC dates in the requested week", () => {
    const response = statusResponse({
      components: statusResponse().components.map((component) => ({
        ...component,
        days: [point("2026-08-02"), ...component.days, point("2026-08-10")],
      })),
    });

    const document = buildWeeklyDocument(response, RANGE);

    expect(document.components).toEqual([
      {
        id: "web",
        upSamples: 2016,
        downSamples: 0,
        expectedSamples: 2016,
        uptimePercent: 100,
        coveragePercent: 100,
      },
      {
        id: "api",
        upSamples: 2016,
        downSamples: 0,
        expectedSamples: 2016,
        uptimePercent: 100,
        coveragePercent: 100,
      },
    ]);
  });

  it("allows missing dates before a launch that starts during the week", () => {
    const launchDay = "2026-08-05";
    const response = statusResponse({
      monitoringStartedAt: "2026-08-05T00:03:00Z",
      components: statusResponse().components.map((component) => ({
        ...component,
        days: WEEK_DAYS.slice(2).map((day) => point(day)),
      })),
    });

    const document = buildWeeklyDocument(response, RANGE);

    expect(document.monitoringStartedAt).toBe("2026-08-05T00:03:00Z");
    expect(document.components.map(({ expectedSamples }) => expectedSamples)).toEqual([
      5 * 288,
      5 * 288,
    ]);
    expect(document.components.map(({ id }) => id)).toEqual(["web", "api"]);
    expect(launchDay).toBe("2026-08-05");
  });

  it("does not count dates that precede a launch even if stale points are returned", () => {
    const response = statusResponse({
      monitoringStartedAt: "2026-08-05T00:03:00Z",
    });

    const document = buildWeeklyDocument(response, RANGE);

    expect(document.components.map(({ expectedSamples }) => expectedSamples)).toEqual([
      5 * 288,
      5 * 288,
    ]);
  });

  it("rejects a missing date after monitoring has started", () => {
    const response = statusResponse({
      components: statusResponse().components.map((component) => ({
        ...component,
        days: component.id === "api" ? component.days.filter(({ day }) => day !== "2026-08-07") : component.days,
      })),
    });

    expect(() => buildWeeklyDocument(response, RANGE)).toThrow("2026-08-07");
  });

  it("keeps no-data aggregates as null uptime instead of inventing zero percent", () => {
    const response = statusResponse({
      components: statusResponse().components.map((component) => ({
        ...component,
        days: WEEK_DAYS.map((day) => point(day, {
          upSamples: 0,
          downSamples: 0,
          uptimePercent: null,
          coveragePercent: 0,
        })),
      })),
    });

    const document = buildWeeklyDocument(response, RANGE);

    expect(document.components.every(({ uptimePercent, coveragePercent }) => uptimePercent === null && coveragePercent === 0)).toBe(true);
  });

  it("serializes deterministically regardless of response component order", () => {
    const response = statusResponse();
    const reversed = statusResponse({
      components: [...response.components].reverse().map((component) => ({
        ...component,
        days: [...component.days].reverse(),
      })),
    });

    expect(JSON.stringify(buildWeeklyDocument(response, RANGE), null, 2)).toBe(
      JSON.stringify(buildWeeklyDocument(reversed, RANGE), null, 2),
    );
  });
});

describe("public endpoint and archive safety", () => {
  it("fetches only the fixed public status endpoint", async () => {
    const fetcher = vi.fn(async () => Response.json(statusResponse())) as unknown as typeof fetch;

    await expect(fetchPublicStatus(fetcher)).resolves.toEqual(statusResponse());
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe("https://status.palate.one/api/status");
    expect(vi.mocked(fetcher).mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
  });

  it("refuses an existing target and leaves its original bytes unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "palate-weekly-"));
    try {
      const document = buildWeeklyDocument(statusResponse(), RANGE);
      const target = await writeWeeklyArchive(document, root);
      const original = await readFile(join(root, target), "utf8");

      await expect(writeWeeklyArchive(document, root)).rejects.toThrow(/already exists/i);
      expect(await readFile(join(root, target), "utf8")).toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates exactly one generated path", async () => {
    const root = await mkdtemp(join(tmpdir(), "palate-weekly-"));
    try {
      const target = await writeWeeklyArchive(buildWeeklyDocument(statusResponse(), RANGE), root);

      expect(target).toBe(weeklyPath(RANGE));
      expect(await readdir(join(root, "content/uptime"))).toEqual(["2026-W32.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a symlinked archive directory without writing outside the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "palate-weekly-root-"));
    const outside = await mkdtemp(join(tmpdir(), "palate-weekly-outside-"));
    try {
      await mkdir(join(root, "content"));
      await symlink(outside, join(root, "content/uptime"), "dir");

      await expect(
        writeWeeklyArchive(buildWeeklyDocument(statusResponse(), RANGE), root),
      ).rejects.toThrow(/archive directory/i);
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("publishes a single validated archive through the fixed endpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "palate-weekly-"));
    const fetcher = vi.fn(async () => Response.json(statusResponse())) as unknown as typeof fetch;
    try {
      const result = await publishWeekly({
        now: new Date("2026-08-10T00:17:00Z"),
        root,
        fetcher,
      });

      expect(result.path).toBe("content/uptime/2026-W32.json");
      expect(JSON.parse(await readFile(join(root, result.path), "utf8")).schemaVersion).toBe(1);
      expect(vi.mocked(fetcher).mock.calls[0][0]).toBe("https://status.palate.one/api/status");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs once after Monday UTC rollover with narrow publication safeguards", async () => {
    const workflow = await readFile(".github/workflows/publish-weekly-uptime.yml", "utf8");

    expect(workflow).toContain('cron: "17 0 * * 1"');
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain(
      "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
    );
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("git add -- \"$GENERATED_PATH\"");
    expect(workflow).toContain("git diff --check");
    expect(workflow).toContain('git config user.name "github-actions[bot]"');
    expect(workflow).toContain(
      'git config user.email "41898282+github-actions[bot]@users.noreply.github.com"',
    );
    expect(workflow).not.toContain("git add -A");
  });

  it("protects the four sensitive repository paths with the verified maintainer", async () => {
    const codeowners = await readFile(".github/CODEOWNERS", "utf8");

    expect(codeowners).toBe([
      "/.github/workflows/ @kitae0522",
      "/migrations/ @kitae0522",
      "/worker/ @kitae0522",
      "/wrangler.jsonc @kitae0522",
      "",
    ].join("\n"));
  });
});

import { execFileSync } from "node:child_process";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function cssToken(css: string, name: string): string {
  const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (!value) throw new Error(`Missing CSS token: --${name}`);
  return value;
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/../g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error(`Invalid color: ${hex}`);
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("status page build", () => {
  it("builds one integrated service status section with two 30-day placeholder rails", async () => {
    execFileSync("bun", ["run", "build"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    });

    const html = await readFile("dist/index.html", "utf8");
    expect(html).toContain("서비스 상태와 최근 30일 가동률");
    expect((html.match(/data-component-id=/g) ?? []).length).toBe(2);
    expect((html.match(/data-uptime-placeholder/g) ?? []).length).toBe(60);
    expect(html).toContain('data-uptime-placeholder aria-hidden="true"');
    expect(html).toContain("측정 데이터 없음");
    expect(html).not.toContain("Read uptime graph for undefined");
    expect(html).toContain('src="/palate-logo.svg"');
    expect(html).toContain('aria-label="Palate 상태 페이지 홈"');
    expect(html).not.toContain("<span>status</span>");
  });

  it("keeps service names, mobile metric values, and the header logo readable", async () => {
    const css = await readFile("src/styles/global.css", "utf8");
    const brandRule = css.match(/\.brand\s*\{([^}]*)\}/)?.[1] ?? "";
    const logoRule = css.match(/\.brand-logo\s*\{([^}]*)\}/)?.[1] ?? "";
    const gridRule = css.match(/\.component-status\s*\{([^}]*)\}/)?.[1] ?? "";
    const headingRule = css.match(/\.component-heading h3\s*\{([^}]*)\}/)?.[1] ?? "";
    const stateRule = css.match(/\.component-state\s*\{\s*margin:\s*0;([^}]*)\}/)?.[1] ?? "";
    const metricRule = css.match(/\.component-metrics dd\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(brandRule).toContain("align-items: center;");
    expect(logoRule).toContain("flex: 0 0 72px;");
    expect(logoRule).toContain("width: 72px;");
    expect(logoRule).toContain("height: 24px;");
    expect(logoRule).toContain("object-fit: cover;");
    expect(logoRule).toContain("object-position: center;");
    expect(gridRule).toContain("minmax(max-content, 0.7fr)");
    expect(headingRule).toContain("white-space: nowrap;");
    expect(stateRule).toContain("white-space: nowrap;");
    expect(metricRule).toContain("word-break: keep-all;");
    expect(metricRule).toContain("overflow-wrap: normal;");
  });

  it("uses the readable muted token for the small uptime note", async () => {
    const css = await readFile("src/styles/global.css", "utf8");
    const noteRule = css.match(/\.uptime-note\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(noteRule).toContain("color: var(--text-muted);");
    expect(noteRule).not.toContain("var(--text-faint)");
  });

  it("renders outage uptime segments as solid red fills", async () => {
    const css = await readFile("src/styles/global.css", "utf8");
    const outageRule = css.match(/\.uptime-day\.has-down\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(outageRule).toContain("border-color: var(--red);");
    expect(outageRule).toContain("background: var(--red);");
    expect(css).not.toMatch(/\.uptime-day\.has-down::after\s*\{/);
  });

  it("keeps the unknown neutral foreground above WCAG AA contrast", async () => {
    const css = await readFile("src/styles/global.css", "utf8");
    const ratio = contrastRatio(cssToken(css, "unknown"), cssToken(css, "unknown-soft"));

    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("explains the non-color uptime cue without pointer-only wording", async () => {
    const [css, uptimeBars, statusClient] = await Promise.all([
      readFile("src/styles/global.css", "utf8"),
      readFile("src/components/UptimeBars.astro", "utf8"),
      readFile("src/scripts/status-client.ts", "utf8"),
    ]);
    const dayRule = css.match(/\.uptime-day\s*\{([^}]*)\}/)?.[1] ?? "";
    const downMarkRule = css.match(/\.uptime-day\.has-down \.day-mark\s*\{([^}]*)\}/)?.[1] ?? "";
    const note = uptimeBars.match(/<p class="uptime-note">([^<]*)<\/p>/)?.[1] ?? "";

    expect(dayRule).toContain("position: relative;");
    expect(downMarkRule).toContain("display: grid;");
    expect(downMarkRule).toContain("clip: auto;");
    expect(downMarkRule).toContain("color: var(--canvas);");
    expect(note).toContain("흰색 !");
    expect(note).not.toContain("마우스");
    expect(uptimeBars).toContain('day.downSamples > 0 ? "!"');
    expect(statusClient).toContain('day.downSamples > 0 ? "!"');
    expect(css).not.toContain(".history-section");
  });

  it("renders resolved history as one KST date group in completion order", async () => {
    const incidentPath = join(
      process.cwd(),
      "content/incidents/inc-9997-01-01-task-2-history.md",
    );
    const maintenancePath = join(
      process.cwd(),
      "content/maintenance/maint-9997-01-01-task-2-history.md",
    );
    const incidentTitle = "TASK2 장애 이력 9997";
    const maintenanceTitle = "TASK2 점검 이력 9997";
    const incidentFixture = `---
id: "inc-9997-01-01-task-2-history"
title: "${incidentTitle}"
status: "resolved"
severity: "degraded"
components: ["api"]
startedAt: "9997-01-01T00:00:00Z"
resolvedAt: "9997-01-01T00:30:00Z"
---

Task 2 incident fixture.
`;
    const maintenanceFixture = `---
id: "maint-9997-01-01-task-2-history"
title: "${maintenanceTitle}"
status: "completed"
components: ["api"]
startsAt: "9997-01-01T00:00:00Z"
endsAt: "9997-01-01T01:00:00Z"
---

Task 2 maintenance fixture.
`;
    const fixturePaths = [incidentPath, maintenancePath];
    const createdPaths: string[] = [];

    try {
      for (const fixturePath of fixturePaths) {
        try {
          await lstat(fixturePath);
          throw new Error(`Reserved test fixture already exists: ${fixturePath}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      }

      await writeFile(incidentPath, incidentFixture, { encoding: "utf8", flag: "wx" });
      createdPaths.push(incidentPath);
      await writeFile(maintenancePath, maintenanceFixture, { encoding: "utf8", flag: "wx" });
      createdPaths.push(maintenancePath);

      execFileSync("bun", ["run", "build"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      });

      const html = await readFile("dist/index.html", "utf8");
      expect((html.match(/<h3[^>]*>\s*<time datetime="9997-01-01"/g) ?? [])).toHaveLength(1);
      expect(html).toContain(incidentTitle);
      expect(html).toContain(maintenanceTitle);
      expect(html.indexOf(maintenanceTitle)).toBeLessThan(html.indexOf(incidentTitle));

      const headingLevels = [...html.matchAll(/<h([1-4])(?:\s|>)/g)].map(([, level]) => Number(level));
      for (let index = 1; index < headingLevels.length; index += 1) {
        expect(headingLevels[index] - headingLevels[index - 1]).toBeLessThanOrEqual(1);
      }
    } finally {
      await Promise.all(createdPaths.map((fixturePath) => rm(fixturePath)));
    }
  });
});

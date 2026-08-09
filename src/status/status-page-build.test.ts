import { execFileSync } from "node:child_process";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
  });

  it("uses the readable muted token for the small uptime note", async () => {
    const css = await readFile("src/styles/global.css", "utf8");
    const noteRule = css.match(/\.uptime-note\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(noteRule).toContain("color: var(--text-muted);");
    expect(noteRule).not.toContain("var(--text-faint)");
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

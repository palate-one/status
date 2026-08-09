import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const mismatchedPath = join(process.cwd(), "content/uptime/2026-W33.json");
const mismatchedDocument = {
  schemaVersion: 1,
  week: "2026-W32",
  from: "2026-08-03T00:00:00Z",
  to: "2026-08-10T00:00:00Z",
  generatedAt: "2026-08-10T00:05:00Z",
  monitoringStartedAt: "2026-08-01T00:00:00Z",
  components: [
    {
      id: "web",
      upSamples: 1,
      downSamples: 0,
      expectedSamples: 1,
      uptimePercent: 100,
      coveragePercent: 100,
    },
  ],
};

describe("weekly uptime content build validation", () => {
  it("rejects a real uptime file whose filename week differs from its document week", async () => {
    await writeFile(mismatchedPath, `${JSON.stringify(mismatchedDocument)}\n`, "utf8");

    try {
      let output = "";
      let failed = false;
      try {
        execFileSync("bun", ["run", "build"], {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: "pipe",
        });
      } catch (error) {
        failed = true;
        if (typeof error === "object" && error !== null) {
          const details = error as { stdout?: string; stderr?: string; message?: string };
          output = [details.stdout, details.stderr, details.message].filter(Boolean).join("\n");
        }
      }

      expect(failed).toBe(true);
      expect(output).toContain("2026-W33.json");
      expect(output).toMatch(/week|filename/i);
    } finally {
      await rm(mismatchedPath, { force: true });
    }
  });
});

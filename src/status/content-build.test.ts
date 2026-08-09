import { execFileSync } from "node:child_process";
import { lstat, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Year 9999 is reserved for this non-production build fixture.
const mismatchedPath = join(process.cwd(), "content/uptime/9999-W02.json");
const mismatchedDocument = {
  schemaVersion: 1,
  week: "9999-W01",
  from: "9999-01-04T00:00:00Z",
  to: "9999-01-11T00:00:00Z",
  generatedAt: "9999-01-11T00:05:00Z",
  monitoringStartedAt: "9999-01-01T00:00:00Z",
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
    try {
      await lstat(mismatchedPath);
      throw new Error(`Reserved test fixture already exists: ${mismatchedPath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    let createdByThisTest = false;

    try {
      await writeFile(mismatchedPath, `${JSON.stringify(mismatchedDocument)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      createdByThisTest = true;

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
      expect(output).toContain("9999-W02.json");
      expect(output).toMatch(/week|filename/i);
    } finally {
      if (createdByThisTest) {
        await rm(mismatchedPath);
      }
    }
  });
});

import { execFileSync } from "node:child_process";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const fixturePath = join(
  process.cwd(),
  "content/incidents/inc-9998-01-01-stale-build-cache.md",
);
const marker = "STALE_BUILD_CACHE_SENTINEL_9998";
const fixture = `---
id: "inc-9998-01-01-stale-build-cache"
title: "${marker}"
status: "investigating"
severity: "degraded"
components: ["web"]
startedAt: "9998-01-01T00:00:00Z"
resolvedAt: null
---

Temporary build-cache fixture.
`;

function build(): void {
  execFileSync("bun", ["run", "build"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "pipe",
  });
}

describe("removed public notices", () => {
  it("cannot survive into a later normal production build", async () => {
    try {
      await lstat(fixturePath);
      throw new Error(`Reserved test fixture already exists: ${fixturePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    let createdByThisTest = false;
    try {
      await writeFile(fixturePath, fixture, { encoding: "utf8", flag: "wx" });
      createdByThisTest = true;
      build();
      expect(await readFile("dist/index.html", "utf8")).toContain(marker);

      await rm(fixturePath);
      createdByThisTest = false;
      build();
      expect(await readFile("dist/index.html", "utf8")).not.toContain(marker);
    } finally {
      if (createdByThisTest) {
        await rm(fixturePath);
      }
    }
  });
});

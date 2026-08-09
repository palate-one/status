import { describe, expect, it } from "vitest";
import manifest from "../package.json";

describe("status repository", () => {
  it("keeps deployment scripts explicit", () => {
    expect(manifest.scripts.build).toBe("astro build");
    expect(manifest.scripts["cf:build"]).toContain("wrangler deploy --dry-run");
  });
});

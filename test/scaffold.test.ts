import { describe, expect, it } from "vitest";
import manifest from "../package.json";

describe("status repository", () => {
  it("keeps deployment scripts explicit", () => {
    expect(manifest.scripts.build).toBe("astro build --force");
    expect(manifest.scripts["cf:build"]).toBe(
      "astro build --force && wrangler deploy --dry-run --outdir .wrangler-dist",
    );
  });
});

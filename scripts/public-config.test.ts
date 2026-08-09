import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("public deployment config", () => {
  it("keeps the production binding free of secret values", async () => {
    const source = await readFile("wrangler.jsonc", "utf8");
    const config = JSON.parse(source) as {
      d1_databases: Array<{ database_id: string }>;
      routes?: Array<{ custom_domain: boolean; pattern: string }>;
      vars?: Record<string, string>;
    };

    expect(config.d1_databases).toHaveLength(1);
    expect(config.d1_databases[0]?.database_id).toMatch(
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,
    );
    expect(config.d1_databases[0]?.database_id).not.toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(config.vars).toBeUndefined();
    expect(config.routes).toEqual([
      {
        pattern: "status.palate.one",
        custom_domain: true,
      },
    ]);
    expect(source).not.toMatch(/STATUS_INGEST_SECRET\s*["':=]/);
  });
});

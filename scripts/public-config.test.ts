import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("public deployment config", () => {
  it("keeps the production binding free of secret values", async () => {
    const source = await readFile("wrangler.jsonc", "utf8");
    const config = JSON.parse(source) as {
      d1_databases: Array<{ database_id: string }>;
      triggers?: { crons: string[] };
      compatibility_flags?: string[];
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
    // 관측 시각은 D1 제약(:03 + 5n)과 같아야 하고, 같은 zone의 요청도 공개 경로로 나가야 한다.
    expect(config.triggers?.crons).toEqual(["3-58/5 * * * *"]);
    expect(config.compatibility_flags).toEqual(["global_fetch_strictly_public"]);
    expect(config.routes).toEqual([
      {
        pattern: "status.palate.one",
        custom_domain: true,
      },
    ]);
    expect(source).not.toMatch(/TELEGRAM_(?:BOT_TOKEN|CHAT_ID)\s*["':=]/);
  });
});

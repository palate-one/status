import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrationsPath = new URL("./migrations", import.meta.url).pathname;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "test/**/*.test.ts",
            "src/**/*.test.ts",
            "scripts/**/*.test.ts",
          ],
        },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            miniflare: {
              compatibilityDate: "2026-08-08",
              d1Databases: ["TEST_DB"],
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(migrationsPath),
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["worker/**/*.test.ts"],
          setupFiles: ["./test/apply-migrations.ts"],
        },
      },
    ],
  },
});

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrationsPath = new URL("./migrations", import.meta.url).pathname;
const contentBuildTests = [
  "src/status/content-build.test.ts",
  "src/status/content-removal-build.test.ts",
];

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
          exclude: contentBuildTests,
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: "content-build",
          include: contentBuildTests,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
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
          sequence: { groupOrder: 0 },
        },
      },
    ],
  },
});

import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

import {
  incidentSchema,
  maintenanceSchema,
  weeklyFilenameMatchesWeek,
  weeklyUptimeSchema,
} from "./status/content-schema";

const weeklyGlobLoader = glob({ pattern: "**/*.json", base: "./content/uptime" });

const weeklyUptimeLoader = {
  ...weeklyGlobLoader,
  name: "weekly-uptime-glob-loader",
  async load(context: Parameters<typeof weeklyGlobLoader.load>[0]) {
    await weeklyGlobLoader.load({
      ...context,
      parseData: async ({ id, data, filePath }) => {
        const week = typeof data.week === "string" ? data.week : "";
        if (!filePath || !weeklyFilenameMatchesWeek(filePath, week)) {
          throw new Error(`Weekly uptime filename "${filePath ?? id}" must match week "${week}"`);
        }
        return context.parseData({ id, data, filePath });
      },
    });
  },
};

export const collections = {
  incidents: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./content/incidents" }),
    schema: incidentSchema,
  }),
  maintenance: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./content/maintenance" }),
    schema: maintenanceSchema,
  }),
  uptime: defineCollection({
    loader: weeklyUptimeLoader,
    schema: weeklyUptimeSchema,
  }),
};

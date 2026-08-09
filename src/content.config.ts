import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

import {
  incidentSchema,
  maintenanceSchema,
  weeklyUptimeSchema,
} from "./status/content-schema";

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
    loader: glob({ pattern: "**/*.json", base: "./content/uptime" }),
    schema: weeklyUptimeSchema,
  }),
};

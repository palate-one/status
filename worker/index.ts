import type { Env } from "./env";
import { runScheduledChecks } from "./monitor";
import { createPublicStatusWorker } from "./read";

export default {
  fetch: createPublicStatusWorker().fetch,
  async scheduled(controller, env) {
    await runScheduledChecks(controller.scheduledTime, env);
  },
} satisfies ExportedHandler<Env>;

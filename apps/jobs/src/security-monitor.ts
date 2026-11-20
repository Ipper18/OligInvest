import type { AppDatabase } from "@oliginvest/db";
import { authMailMessages, formatMessage } from "@oliginvest/i18n";
import { copies } from "@oliginvest/i18n/en";
import type { PlatformLogger } from "@oliginvest/platform";
import type { Queue } from "bullmq";
import { identityJobs, notificationJobSchema } from "./modules.js";

/** Same incident rule, audit and recipient selection as the API SecurityMonitor. */
export function monitorJobDatabase(
  database: AppDatabase,
  pseudonymKey: string,
  queue: Queue,
  logger: PlatformLogger,
) {
  const report = identityJobs.createSecurityIncidentReporter(database, pseudonymKey, {
    messages: { "pl-PL": authMailMessages, "en-US": copies.authMailMessages },
    formatMessage,
    notify: async (id, payload) => {
      await queue.add("notifications.deliver", notificationJobSchema.parse(payload), {
        jobId: id,
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      });
    },
  });
  return identityJobs.observeRlsViolations(
    database,
    (actor) => report(actor, "rls"),
    () => logger.error({ event: "security.rls_reporting_failed" }),
  );
}

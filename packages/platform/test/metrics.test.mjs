import { expect, test } from "vitest";
import { Metrics } from "../dist/index.js";

test("duration buckets are cumulative, counters aggregate and gauges replace", () => {
  const metrics = new Metrics();
  metrics.duration("http_request_duration_seconds", { route: "/api/v1/accounts/:id" }, 0.2);
  metrics.duration("http_request_duration_seconds", { route: "/api/v1/accounts/:id" }, 0.4);
  metrics.gauge("queue_jobs", { queue: "import" }, 2);
  metrics.gauge("queue_jobs", { queue: "import" }, 1);
  const output = metrics.render();
  expect(output).toContain(
    'http_request_duration_seconds_bucket{le="0.3",route="/api/v1/accounts/:id"} 1',
  );
  expect(output).toContain(
    'http_request_duration_seconds_bucket{le="+Inf",route="/api/v1/accounts/:id"} 2',
  );
  expect(output).toContain('queue_jobs{queue="import"} 1');
  expect(() => metrics.add("requests", { route: 'bad"\nvalue' })).toThrow();
  expect(() => metrics.duration("requests", {}, NaN)).toThrow();
});

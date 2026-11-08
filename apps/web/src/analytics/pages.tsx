import { formatDateTime, formatMessage } from "@oliginvest/i18n";
import { analyticsMessages as m } from "@oliginvest/i18n/analytics";
import { AssumptionsBlock, Disclaimer, Panel } from "@oliginvest/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import * as z from "zod";
import { cancelRun, createRun } from "./actions";
import { readLimits, readRun, readRuns, requireAnalytics } from "./data";
import { LiveRun } from "./live-run";
import { Result } from "./result";
import styles from "./screens.module.css";

const RENEWAL_ZONE = "Europe/Warsaw";
type Search = Promise<Record<string, string | string[] | undefined>>;
const types = {
  "monte-carlo": "monte_carlo",
  "testy-skrajne": "stress_test",
  cel: "goal",
} as const;
export async function AnalyticsList({ searchParams }: { searchParams: Search }) {
  await requireAnalytics();
  const search = await searchParams;
  const cursor = z.string().max(512).optional().parse(search.cursor);
  const [limits, runs] = await Promise.all([readLimits(), readRuns(cursor)]);
  const renewal = z.iso.datetime().safeParse(search.renewal);
  return (
    <section className={styles.screen}>
      <h1>{m.title}</h1>
      <p>{m.intro}</p>
      {search.error && (
        <Panel>
          <div role="alert">
            {search.error === "QUOTA_EXCEEDED" ? (
              <>
                <p>{m.quota}</p>
                <p>
                  {renewal.success
                    ? formatMessage(m.renewal, {
                        time: formatDateTime(renewal.data, RENEWAL_ZONE),
                      })
                    : m.renewalUnknown}
                </p>
              </>
            ) : (
              <p>
                {search.error === "FORBIDDEN"
                  ? m.forbidden
                  : search.error === "VALIDATION_FAILED"
                    ? m.invalid
                    : m.failed}
              </p>
            )}
          </div>
        </Panel>
      )}
      <Panel>
        <h2>{m.new}</h2>
        {limits.role === "user" ? (
          <p>{m.role}</p>
        ) : (
          <>
            <p>
              {formatMessage(m.usage, {
                used: String(limits.heavyRunsUsedToday),
                limit: String(limits.heavyRunsPerDay ?? 0),
              })}
            </p>
            <p>{m.dailyReset}</p>
          </>
        )}
        <ul>
          {Object.entries(types).map(([slug, type]) => (
            <li key={type}>
              <Link prefetch={false} href={`/analizy/nowa/${slug}`}>
                {m.types[type]}
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <h2>{m.history}</h2>
        {runs.data.length ? (
          <ul>
            {runs.data.map((run) => (
              <li key={run.id}>
                <Link prefetch={false} href={`/analizy/${run.id}`}>
                  {m.types[run.type]} — {m.states[run.status]} — {formatDateTime(run.createdAt)}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>{m.empty}</p>
        )}
        {runs.page.hasMore && runs.page.nextCursor && (
          <Link href={`/analizy?cursor=${encodeURIComponent(runs.page.nextCursor)}`}>{m.next}</Link>
        )}
      </Panel>
      <Disclaimer disclaimerKey="analysis" version="2026-09" />
    </section>
  );
}
export async function AnalyticsNew({ params }: { params: Promise<{ typ: string }> }) {
  const me = await requireAnalytics();
  const { typ } = await params;
  if (!(typ in types)) notFound();
  const type = types[typ as keyof typeof types];
  return (
    <section className={styles.screen}>
      <Link href="/analizy">{m.back}</Link>
      <h1>{m.types[type]}</h1>
      {me.role === "user" ? (
        <Panel>
          <p>{m.role}</p>
        </Panel>
      ) : (
        <Panel>
          <form action={createRun}>
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="key" value={crypto.randomUUID()} />
            {type === "stress_test" ? (
              Object.entries({
                horizonYears: "10",
                paths: "5000",
                seed: "42",
                target: "50000",
                inflationRate: "0.025",
                annualCostRate: "0",
                taxMode: "belka_simplified",
              }).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))
            ) : (
              <div className={styles.fields}>
                <label>
                  {m.horizon}
                  <input
                    name="horizonYears"
                    type="number"
                    min="1"
                    max="40"
                    defaultValue="10"
                    required
                  />
                </label>
                <label>
                  {m.paths}
                  <input
                    name="paths"
                    type="number"
                    min="100"
                    max="10000"
                    defaultValue="5000"
                    required
                  />
                </label>
                <label>
                  {m.seed}
                  <input
                    name="seed"
                    type="number"
                    min="0"
                    max={Number.MAX_SAFE_INTEGER}
                    defaultValue="42"
                    required
                  />
                </label>
                <label>
                  {m.target}
                  <input
                    name="target"
                    inputMode="decimal"
                    pattern="[1-9][0-9]{0,13}(\.[0-9]{1,2})?"
                    defaultValue="50000"
                    required
                  />
                </label>
                <label>
                  {m.inflation}
                  <input
                    name="inflationRate"
                    type="number"
                    min="0"
                    max="0.2"
                    step="0.001"
                    defaultValue="0.025"
                    required
                  />
                </label>
                <label>
                  {m.cost}
                  <input
                    name="annualCostRate"
                    type="number"
                    min="0"
                    max="0.05"
                    step="0.001"
                    defaultValue="0"
                    required
                  />
                </label>
                <label>
                  {m.tax}
                  <select name="taxMode" defaultValue="belka_simplified">
                    {Object.entries(m.taxModes).map(([key, name]) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <AssumptionsBlock summary={m.preview}>
              <p>{m.previewText}</p>
            </AssumptionsBlock>
            <Disclaimer disclaimerKey="analysis" version="2026-09" />
            <button className="oi-button oi-button-primary" type="submit">
              {m.run}
            </button>
          </form>
        </Panel>
      )}
    </section>
  );
}
export async function AnalyticsDetail({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Search;
}) {
  const me = await requireAnalytics();
  const run = await readRun((await params).runId);
  const search = await searchParams;
  const pageSchema = z.coerce.number().int().min(0).max(399).catch(0);
  const page = pageSchema.parse(search.page ?? 0);
  const sourcePage = Math.min(
    pageSchema.parse(search.sources ?? 0),
    Math.max(0, Math.ceil((run.seriesMetadata?.length ?? 0) / 50) - 1),
  );
  const positionPage = pageSchema.parse(search.positions ?? 0);
  const real = search.value === "real";
  return (
    <section className={styles.screen}>
      <Link href="/analizy">{m.back}</Link>
      <h1>{m.types[run.type]}</h1>
      <p role="status">{m.states[run.status]}</p>
      {search.error && <p role="alert">{m.failed}</p>}
      {run.status === "running" || run.status === "queued" ? (
        <Panel>
          <label>
            {m.progress}
            <progress max={100} value={run.progress} />
          </label>
          <LiveRun initial={run} userId={me.id} />
          <form action={cancelRun}>
            <input type="hidden" name="id" value={run.id} />
            <button className="oi-button" type="submit">
              {m.cancel}
            </button>
          </form>
        </Panel>
      ) : null}
      {run.status === "failed" && (
        <Panel>
          <p role="alert">{run.error?.message ?? m.failed}</p>
        </Panel>
      )}
      {run.status === "done" && run.result ? (
        <Result
          run={run}
          page={page}
          real={real}
          sourcePage={sourcePage}
          positionPage={positionPage}
        />
      ) : (
        <>
          <AssumptionsBlock summary={m.assumptions}>
            <p>{m.previewText}</p>
          </AssumptionsBlock>
          <Disclaimer disclaimerKey="analysis" version="2026-09" />
        </>
      )}
    </section>
  );
}

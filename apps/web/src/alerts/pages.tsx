import { randomUUID } from "node:crypto";
import { formatMessage } from "@oliginvest/i18n";
import { AssumptionsBlock, DataFreshness, Disclaimer, Panel } from "@oliginvest/ui";
import { useFormatters } from "@oliginvest/ui/localization-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { components } from "../api/schema";
import { changeAlert, saveAlert } from "./actions";
import { alertsContext, checked, ruleTypes } from "./data";
import styles from "./screens.module.css";

type Copy = Awaited<ReturnType<typeof alertsContext>>["m"];
type Search = Promise<Record<string, string | string[] | undefined>>;
type Event = components["schemas"]["PriceAlertEvent"];
function Notes({ m }: { m: Copy }) {
  return (
    <>
      <AssumptionsBlock summary={m.basis}>
        <p>{m.note}</p>
      </AssumptionsBlock>
      <Disclaimer disclaimerKey="alerts" version="2026-09" />
    </>
  );
}
function Events({ data, m }: { data: Event[]; m: Copy }) {
  const { formatDateTime } = useFormatters();
  return data.length ? (
    <ol>
      {data.map((e) => (
        <li key={e.id}>
          <p>{e.message}</p>
          <time dateTime={e.triggeredAt}>{formatDateTime(e.triggeredAt)}</time>
          {e.delayMinutes !== undefined && (
            <DataFreshness
              kind="delayed"
              meta={{
                source: e.dataSource,
                asOf: e.dataAsOf,
                delayMinutes: e.delayMinutes,
                stale: false,
              }}
            />
          )}
          <p>{m.delivery}</p>
          {e.deliveries.length ? (
            <ul>
              {e.deliveries.map((d) => (
                <li key={d.channel}>
                  {m[d.channel]} · {m[d.status]} {d.sentAt && formatDateTime(d.sentAt)}
                </li>
              ))}
            </ul>
          ) : (
            <p>{m.pending}</p>
          )}
        </li>
      ))}
    </ol>
  ) : (
    <p>{m.empty}</p>
  );
}

export async function AlertList({ searchParams }: { searchParams: Search }) {
  const { api, m } = await alertsContext();
  const cursor = z
    .string()
    .max(512)
    .optional()
    .parse((await searchParams).cursor);
  const [rules, events] = await Promise.all([
    api.GET("/alerts/rules", { params: { query: { limit: 20, ...(cursor ? { cursor } : {}) } } }),
    api.GET("/alerts/events", { params: { query: { limit: 5 } } }),
  ]);
  const page = checked(rules);
  return (
    <section className={styles.screen}>
      <h1>{m.title}</h1>
      <nav>
        <Link href="/alerty/nowy">{m.create}</Link>
        <Link href="/alerty/historia">{m.history}</Link>
      </nav>
      <Panel>
        <h2>{m.rules}</h2>
        {page.data.length ? (
          <ul>
            {page.data.map((r) => (
              <li key={r.id}>
                <Link href={`/alerty/${r.id}`}>
                  {m[r.type]} · {r.params.threshold}
                </Link>{" "}
                · {r.enabled ? m.active : m.inactive} {r.inactiveReason && m[r.inactiveReason]}
              </li>
            ))}
          </ul>
        ) : (
          <p>{m.empty}</p>
        )}
        {page.page.nextCursor && (
          <Link href={{ pathname: "/alerty", query: { cursor: page.page.nextCursor } }}>
            {m.next}
          </Link>
        )}
      </Panel>
      <Panel>
        <h2>{m.recent}</h2>
        <Events m={m} data={checked(events).data} />
      </Panel>
      <Notes m={m} />
    </section>
  );
}
export async function AlertHistory({ searchParams }: { searchParams: Search }) {
  const { api, m } = await alertsContext();
  const search = await searchParams;
  const cursor = z.string().max(512).optional().parse(search.cursor);
  const ruleId = z.uuid().optional().parse(search.ruleId);
  const page = checked(
    await api.GET("/alerts/events", {
      params: {
        query: { limit: 25, ...(cursor ? { cursor } : {}), ...(ruleId ? { ruleId } : {}) },
      },
    }),
  );
  return (
    <section className={styles.screen}>
      <h1>{m.history}</h1>
      <Link href="/alerty">{m.back}</Link>
      <Panel>
        <Events m={m} data={page.data} />
      </Panel>
      {page.page.nextCursor && (
        <Link
          href={{
            pathname: "/alerty/historia",
            query: { cursor: page.page.nextCursor, ...(ruleId ? { ruleId } : {}) },
          }}
        >
          {m.next}
        </Link>
      )}
      <Notes m={m} />
    </section>
  );
}
export async function AlertDetail({
  params,
  searchParams,
}: {
  params: Promise<{ ruleId: string }>;
  searchParams: Search;
}) {
  const { api, m } = await alertsContext();
  const id = z.uuid().safeParse((await params).ruleId);
  if (!id.success) notFound();
  const r = checked(
    await api.GET("/alerts/rules/{ruleId}", { params: { path: { ruleId: id.data } } }),
  );
  return (
    <section className={styles.screen}>
      <h1>{m[r.type]}</h1>
      <Link href="/alerty">{m.back}</Link>
      <Panel>
        <p>
          {m.threshold}: {r.params.threshold}
        </p>
        <p>
          {r.enabled ? m.active : m.inactive} {r.inactiveReason && m[r.inactiveReason]}
        </p>
        {(await searchParams).error && <p role="alert">{m.invalid}</p>}
        <form action={changeAlert}>
          <input type="hidden" name="id" value={id.data} />
          {!r.inactiveReason && (
            <button type="submit" name="action" value={r.enabled ? "disable" : "enable"}>
              {r.enabled ? m.disable : m.enable}
            </button>
          )}
          <button type="submit" name="action" value="remove">
            {m.remove}
          </button>
        </form>
        <Link href={{ pathname: "/alerty/historia", query: { ruleId: id.data } }}>{m.history}</Link>
      </Panel>
      <Notes m={m} />
    </section>
  );
}
export async function AlertWizard({ searchParams }: { searchParams: Search }) {
  const { api, m, format, messages } = await alertsContext();
  const search = await searchParams;
  const type = ruleTypes.catch("price_above").parse(search.type);
  const price = type === "price_above" || type === "price_below";
  const market = price || type === "change_pct";
  const q = z.string().max(64).catch("").parse(search.q);
  const id = z.uuid().safeParse(search.instrumentId);
  const instrument =
    market && id.success
      ? checked(
          await api.GET("/market/instruments/{instrumentId}", {
            params: { path: { instrumentId: id.data } },
          }),
        )
      : undefined;
  const matches =
    market && q && !instrument
      ? checked(await api.GET("/market/instruments", { params: { query: { q, limit: 20 } } })).data
      : [];
  const targets =
    type === "allocation_drift" ? checked(await api.GET("/portfolio/targets")).data : [];
  const target = targets.find((t) => t.id === search.targetId);
  const threshold = z
    .string()
    .regex(/^\d{1,12}(\.\d{1,8})?$/)
    .safeParse(search.threshold);
  const channels = z
    .array(z.enum(["push", "email"]))
    .min(1)
    .safeParse(
      Array.isArray(search.channel) ? search.channel : search.channel ? [search.channel] : [],
    );
  const ready =
    (!market || instrument) &&
    (type !== "allocation_drift" || target) &&
    threshold.success &&
    Number(threshold.data) > 0 &&
    (type !== "change_pct" || Number(threshold.data) <= 1) &&
    channels.success;
  const unit = price ? instrument?.currency : m.fraction;
  const summary = market
    ? undefined
    : checked(
        await api.GET("/portfolio/summary", {
          params: { query: target?.accountId ? { accountId: [target.accountId] } : {} },
        }),
      );
  const meta = instrument?.quote?.meta ?? summary?.meta;
  const template =
    type === "price_above"
      ? messages.priceAbove
      : type === "price_below"
        ? messages.priceBelow
        : type === "change_pct"
          ? messages.change
          : messages[type];
  const thresholdText = threshold.success
    ? price
      ? threshold.data + " " + instrument?.currency
      : type === "change_pct"
        ? format.formatPercent(threshold.data)
        : format.formatPercent(threshold.data).replace(/%/u, "").trim()
    : "";
  const previewText = formatMessage(template, {
    ticker: instrument?.ticker ?? "",
    value: m.observed,
    threshold: thresholdText,
  });
  return (
    <section className={styles.screen}>
      <h1>{m.create}</h1>
      <Link href="/alerty">{m.back}</Link>
      {(search.error || (search.preview && !ready)) && <p role="alert">{m.invalid}</p>}
      <Panel>
        <form>
          <label>
            {m.condition}
            <select name="type" defaultValue={type}>
              {ruleTypes.options.map((t) => (
                <option key={t} value={t}>
                  {m[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {m.search}
            <input name="q" defaultValue={q} maxLength={64} />
          </label>
          <button type="submit">{m.choose}</button>
        </form>
        {market &&
          q &&
          !instrument &&
          (matches.length ? (
            <ul>
              {matches.map((i) => (
                <li key={i.id}>
                  <Link href={{ pathname: "/alerty/nowy", query: { type, instrumentId: i.id } }}>
                    {i.ticker} · {i.name} · {i.currency}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>{m.empty}</p>
          ))}
      </Panel>
      {(!market || instrument) && (
        <Panel>
          <h2>{m.params}</h2>
          {instrument && (
            <p>
              {instrument.ticker} · {instrument.name} · {instrument.currency}
            </p>
          )}
          {meta ? (
            <DataFreshness kind="delayed" meta={meta} />
          ) : (
            <p>{market ? m.missing : m.computed + " " + m.delay}</p>
          )}
          <form>
            <input type="hidden" name="type" value={type} />
            {instrument && <input type="hidden" name="instrumentId" value={instrument.id} />}
            {type === "allocation_drift" && (
              <label>
                {m.target}
                <select name="targetId" required defaultValue={target?.id}>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {!targets.length && m.noTargets}
              </label>
            )}
            <label>
              {m.threshold} ({unit})
              <input name="threshold" required inputMode="decimal" defaultValue={threshold.data} />
            </label>
            <fieldset>
              <legend>{m.channels}</legend>
              {(["push", "email"] as const).map((c) => (
                <label key={c}>
                  <input
                    name="channel"
                    type="checkbox"
                    value={c}
                    defaultChecked={channels.data?.includes(c) ?? true}
                  />
                  {m[c]}
                </label>
              ))}
            </fieldset>
            <button type="submit" name="preview" value="1">
              {m.preview}
            </button>
          </form>
        </Panel>
      )}
      {ready && (
        <Panel>
          <h2>{m.preview}</h2>
          <p>
            {previewText}{" "}
            {meta
              ? formatMessage(messages.metadata, {
                  triggeredAt: m.atTrigger,
                  dataAsOf: format.formatDateTime(meta.asOf),
                  delayMinutes: String(meta.delayMinutes),
                  source: meta.source,
                  url: "",
                })
              : m.missing}
          </p>
          {instrument && <Link href={`/rynek/${instrument.id}`}>{instrument.ticker}</Link>}
          <p>{channels.data.map((c) => m[c]).join(" · ")}</p>
          <form action={saveAlert}>
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="key" value={randomUUID()} />
            <input type="hidden" name="threshold" value={threshold.data} />
            {instrument && <input type="hidden" name="instrumentId" value={instrument.id} />}
            {target && <input type="hidden" name="targetId" value={target.id} />}
            {channels.data.map((c) => (
              <input key={c} type="hidden" name="channel" value={c} />
            ))}
            <button type="submit">{m.save}</button>
          </form>
        </Panel>
      )}
      <Notes m={m} />
    </section>
  );
}

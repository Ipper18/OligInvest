import {
  type DisclaimerKey,
  disclaimers,
  formatDate,
  formatDateTime,
  formatMessage,
  formatQuantity,
  messages,
} from "@oliginvest/i18n";
import type { ReactNode } from "react";
import { Disclosure } from "./native-controls.js";

export type DataMeta = {
  source: string;
  asOf: string;
  delayMinutes: number;
  stale: boolean;
  staleReason?: keyof typeof messages.data.reasons;
  attribution?: string;
};
type FreshnessProps = { meta: DataMeta; timeZone?: string } & (
  | { kind: "delayed" }
  | { kind: "eod"; sessionDate: string }
  | { kind: "fx"; sessionDate: string; meta: DataMeta & { source: "nbp" } }
);

export function DataFreshness(props: FreshnessProps) {
  const { meta, timeZone } = props;
  if (props.kind === "fx" && meta.source !== "nbp")
    throw new RangeError("FX copy requires NBP data");
  const time = formatDateTime(meta.asOf, timeZone);
  const text =
    props.kind === "delayed"
      ? formatMessage(messages.data.delayed, {
          time,
          minutes: formatQuantity(String(meta.delayMinutes)),
          source: meta.source,
        })
      : formatMessage(props.kind === "fx" ? messages.data.fx : messages.data.eod, {
          date: formatDate(props.sessionDate),
          source: meta.source,
        });
  const reason = meta.staleReason ? messages.data.reasons[meta.staleReason] : undefined;
  return (
    <div className="oi-freshness" data-freshness-source={meta.source} data-stale={meta.stale}>
      <p>
        <time dateTime={props.kind === "delayed" ? meta.asOf : props.sessionDate} title={time}>
          {text}
        </time>
      </p>
      {props.kind === "fx" && <p>{meta.source}</p>}
      {meta.attribution && <p>{meta.attribution}</p>}
      <div role="status" aria-live="polite" aria-atomic="true">
        {meta.stale && (
          <p className="oi-stale">
            <strong>{messages.data.staleLabel}</strong>
            {" · "}
            {reason
              ? formatMessage(messages.data.stale, { time, reason })
              : formatMessage(messages.shell.stale, { time })}
          </p>
        )}
      </div>
    </div>
  );
}

export function AssumptionsBlock({
  summary,
  children,
  initiallyOpen = true,
}: {
  summary: string;
  children: ReactNode;
  initiallyOpen?: boolean;
}) {
  return (
    <Disclosure
      initiallyOpen={initiallyOpen}
      summary={
        <>
          <strong>{messages.data.assumptions}</strong>
          <span className="oi-assumptions-summary">{summary}</span>
        </>
      }
    >
      {children}
    </Disclosure>
  );
}

export function Disclaimer({
  disclaimerKey,
  version,
}: {
  disclaimerKey: DisclaimerKey;
  version: string;
}) {
  const entry = disclaimers[disclaimerKey];
  if (!entry || entry.version !== version)
    throw new RangeError("Unknown disclaimer key or version");
  return (
    <p
      className="oi-disclaimer"
      data-disclaimer-key={disclaimerKey}
      data-disclaimer-version={entry.version}
    >
      {entry.text}
    </p>
  );
}

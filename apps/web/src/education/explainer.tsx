"use client";
import { formatMessage } from "@oliginvest/i18n";
import { educationMessages as m } from "@oliginvest/i18n/education";
import { type ComponentType, useId, useState } from "react";
import type { EducationEntry } from "./catalog";

export function Explainer({ termKey, term }: { termKey: string; term: string }) {
  const id = useId();
  const [entry, setEntry] = useState<EducationEntry | null>(null);
  const [failed, setFailed] = useState(false);
  const [View, setView] = useState<ComponentType<{ entry: EducationEntry }> | null>(null);
  const load = async () => {
    if (entry) return;
    setFailed(false);
    try {
      const [{ readExplainer }, { EntryView }] = await Promise.all([
        import("./read-action"),
        import("./entry-view"),
      ]);
      const result = await readExplainer(termKey);
      setView(() => EntryView);
      setEntry(result);
      setFailed(!result);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="oi-popover-root">
      <button
        className="oi-button"
        type="button"
        popoverTarget={id}
        aria-label={formatMessage(m.explain, { term })}
        onClick={() => void load()}
      >
        ?
      </button>
      <div id={id} popover="auto" className="oi-popover">
        {entry && View ? (
          <View entry={entry} />
        ) : (
          <span role="status">{failed ? m.unavailable : m.loading}</span>
        )}
        {failed && (
          <button type="button" className="oi-button" onClick={() => void load()}>
            {m.retry}
          </button>
        )}
      </div>
    </div>
  );
}

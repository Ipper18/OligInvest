"use client";

import { formatMessage } from "@oliginvest/i18n";
import { educationMessages as defaultM } from "@oliginvest/i18n/education";
import { Explainer as InfoPopover } from "@oliginvest/ui";
import { useCopy } from "@oliginvest/ui/localization";
import { type ComponentType, useState } from "react";
import type { EducationEntry } from "./catalog";

export function Explainer({ termKey, term }: { termKey: string; term: string }) {
  const m = useCopy("educationMessages", defaultM);

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
    <InfoPopover label={formatMessage(m.explain, { term })} onOpen={() => void load()}>
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
    </InfoPopover>
  );
}

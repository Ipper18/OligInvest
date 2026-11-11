"use client";
import { appMessages, commonMessages } from "@oliginvest/i18n";
import { preferencesMessages } from "@oliginvest/i18n/preferences";
import { Button, SelectField, TextField } from "@oliginvest/ui";
import { useCopy } from "@oliginvest/ui/localization";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Me, Preferences } from "../api/validation";
import { submitAction } from "../auth/actions";
import { readPreferences } from "./preference-actions";

const editable = [
  "theme",
  "plPalette",
  "costBasisMethod",
  "plView",
  "taxDateBasis",
  "taxIncludeFxFee",
  "timezone",
  "locale",
] as const;
function applyAppearance(preferences: Preferences) {
  document.documentElement.dataset.theme = preferences.theme;
  document.documentElement.dataset.palette =
    preferences.plPalette === "colorblind" ? "colorblind" : "standard";
}
export function Settings({ preferences, userId }: { preferences: Preferences; userId: string }) {
  const t = useCopy("appMessages", appMessages);
  const actions = useCopy("commonMessages", commonMessages);
  const p = useCopy("preferencesMessages", preferencesMessages);
  const [current, setCurrent] = useState(preferences);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const dirty = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const client = useQueryClient();
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || dirty.current || pending) return;
      try {
        const next = await readPreferences();
        if (!active || !next || dirty.current) return;
        if (next.locale !== current.locale || next.timezone !== current.timezone) {
          window.location.reload();
          return;
        }
        setCurrent(next);
        setRevision((value) => value + 1);
        applyAppearance(next);
      } catch {
        if (active) setMessage(p.refreshFailed);
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [current.locale, current.timezone, pending, p.refreshFailed]);
  return (
    <form
      key={revision}
      ref={form}
      className="oi-form"
      aria-busy={pending}
      onChange={() => {
        dirty.current = true;
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const value = Object.fromEntries(
          editable.map((key) => [
            key,
            key === "taxIncludeFxFee" ? fields.get(key) === "on" : fields.get(key),
          ]),
        );
        const patch = Object.fromEntries(
          editable.filter((key) => value[key] !== current[key]).map((key) => [key, value[key]]),
        );
        if (Object.keys(patch).length === 0) {
          setMessage(t.saved);
          return;
        }
        setPending(true);
        const result = await submitAction("preferences", patch);
        setPending(false);
        if (!result.ok) {
          setMessage(result.code === "VALIDATION_FAILED" ? p.invalid : t.offline);
          return;
        }
        const next = result.data as Preferences;
        applyAppearance(next);
        void client.invalidateQueries({ queryKey: [userId, "portfolio"] });
        dirty.current = false;
        setCurrent(next);
        setRevision((value) => value + 1);
        setMessage(t.saved);
        client.setQueriesData<Me>(
          { predicate: (query) => query.queryKey[1] === "me" },
          (me) => me && { ...me, preferences: next },
        );
        // The /auth/action response already set the HttpOnly language cookie (locale-cookie.ts).
        if (next.locale !== current.locale || next.timezone !== current.timezone)
          window.location.reload();
      }}
    >
      <h2>{p.title}</h2>
      <SelectField
        id="costBasisMethod"
        name="costBasisMethod"
        label={p.costBasisMethod}
        defaultValue={current.costBasisMethod}
        description={p.costHint}
      >
        <option value="fifo">{p.fifo}</option>
        <option value="average">{p.average}</option>
      </SelectField>
      <SelectField id="plView" name="plView" label={p.plView} defaultValue={current.plView}>
        <option value="economic">{p.economic}</option>
        <option value="tax">{p.tax}</option>
      </SelectField>
      <SelectField
        id="taxDateBasis"
        name="taxDateBasis"
        label={p.taxDateBasis}
        defaultValue={current.taxDateBasis}
        description={p.taxHint}
      >
        <option value="settlement">{p.settlement}</option>
        <option value="trade">{p.trade}</option>
      </SelectField>
      <label className="oi-check">
        <input type="checkbox" name="taxIncludeFxFee" defaultChecked={current.taxIncludeFxFee} />
        {p.taxIncludeFxFee}
      </label>
      <TextField
        id="timezone"
        name="timezone"
        label={p.timezone}
        description={p.timezoneHint}
        defaultValue={current.timezone}
        required
        maxLength={64}
      />
      <SelectField id="locale" name="locale" label={p.locale} defaultValue={current.locale}>
        <option value="pl-PL">{p["pl-PL"]}</option>
        <option value="en-US">{p["en-US"]}</option>
      </SelectField>
      <SelectField id="theme" name="theme" label={t.theme} defaultValue={current.theme}>
        {(["dark", "light", "system"] as const).map((value) => (
          <option key={value} value={value}>
            {t[value]}
          </option>
        ))}
      </SelectField>
      <SelectField
        id="plPalette"
        name="plPalette"
        label={t.palette}
        defaultValue={current.plPalette}
      >
        {(["default", "colorblind"] as const).map((value) => (
          <option key={value} value={value}>
            {t[value]}
          </option>
        ))}
      </SelectField>
      <SelectField
        id="baseCurrency"
        label={t.baseCurrency}
        value={current.baseCurrency}
        disabled
        description={t.currencyHint}
      >
        <option value={current.baseCurrency}>{current.baseCurrency}</option>
      </SelectField>
      <p className="oi-help">{p.sync}</p>
      <Button type="submit" disabled={pending}>
        {actions.action.save}
      </Button>
      <p role="status">{message}</p>
    </form>
  );
}

"use client";
import { appMessages, commonMessages } from "@oliginvest/i18n";
import { Button, SelectField } from "@oliginvest/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Preferences } from "../api/validation";
import { submitAction } from "../auth/actions";

const t = appMessages;
export function Settings({ preferences }: { preferences: Preferences }) {
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <form
      className="oi-form"
      aria-busy={pending}
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const fields = new FormData(e.currentTarget);
        const result = await submitAction("preferences", {
          theme: fields.get("theme"),
          plPalette: fields.get("plPalette"),
        });
        setPending(false);
        if (result.ok) {
          document.documentElement.dataset.theme = String(result.data.theme);
          document.documentElement.dataset.palette =
            result.data.plPalette === "colorblind" ? "colorblind" : "standard";
          setMessage(t.saved);
          router.refresh();
        } else setMessage(appMessages.offline);
      }}
    >
      <SelectField id="theme" name="theme" label={t.theme} defaultValue={preferences.theme}>
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
        defaultValue={preferences.plPalette}
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
        value={preferences.baseCurrency}
        disabled
        description={t.currencyHint}
      >
        <option value={preferences.baseCurrency}>{preferences.baseCurrency}</option>
      </SelectField>
      <Button type="submit" disabled={pending}>
        {commonMessages.action.save}
      </Button>
      <p role="status">{message}</p>
    </form>
  );
}

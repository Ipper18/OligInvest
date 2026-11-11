"use client";
import { onboardingMessages as defaultM } from "@oliginvest/i18n/onboarding";
import { useCopy } from "@oliginvest/ui/localization";
import { useState } from "react";
export function OnboardingButton() {
  const m = useCopy("onboardingMessages", defaultM);

  const [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <>
      <button
        type="button"
        className="oi-button"
        disabled={busy}
        onClick={async (event) => {
          const trigger = event.currentTarget;
          setBusy(true);
          setError(false);
          try {
            await (await import("./onboarding")).startOnboarding(
              true,
              () => trigger.isConnected,
              trigger,
            );
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {m.start}
      </button>
      {error && <p role="alert">{m.error}</p>}
    </>
  );
}

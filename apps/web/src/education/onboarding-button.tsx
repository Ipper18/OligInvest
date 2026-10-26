"use client";
import { onboardingMessages as m } from "@oliginvest/i18n/onboarding";
import { useState } from "react";
export function OnboardingButton() {
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

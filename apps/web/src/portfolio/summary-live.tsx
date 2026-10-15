"use client";
import { portfolioMessages as m } from "@oliginvest/i18n";
import { type ComponentType, type ReactNode, useEffect, useState } from "react";
import type { Resource } from "./resources";
import type { Props } from "./summary-screen";

type SummaryProps = Props<"summary"> & { initialDay: Resource<"day"> };
export function SummaryLive({ fallback, ...props }: SummaryProps & { fallback: ReactNode }) {
  const [Screen, setScreen] = useState<ComponentType<SummaryProps> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: An explicit retry restarts a failed chunk request.
  useEffect(() => {
    let active = true;
    setFailed(false);
    void import("./summary-screen")
      .then(({ SummaryScreen }) => {
        if (active) setScreen(() => SummaryScreen);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return Screen ? (
    <Screen {...props} />
  ) : (
    <>
      {failed && (
        <div role="alert">
          <p>{m.failed}</p>
          <button className="oi-button" type="button" onClick={() => setAttempt(attempt + 1)}>
            {m.retry}
          </button>
        </div>
      )}
      {fallback}
    </>
  );
}

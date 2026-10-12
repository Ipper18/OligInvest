"use client";
import { commonMessages, errorMessages } from "@oliginvest/i18n";
import { Button, ScreenState } from "@oliginvest/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <ScreenState title={errorMessages.INTERNAL.title}>
      <Button onClick={reset}>{commonMessages.action.retry}</Button>
    </ScreenState>
  );
}

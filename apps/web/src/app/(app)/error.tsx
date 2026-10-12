"use client";
import { errorMessages, messages } from "@oliginvest/i18n";
import { Button, ScreenState } from "@oliginvest/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <ScreenState title={errorMessages.INTERNAL.title}>
      <Button onClick={reset}>{messages.action.retry}</Button>
    </ScreenState>
  );
}

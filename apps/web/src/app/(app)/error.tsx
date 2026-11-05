"use client";
import { commonMessages, errorMessages } from "@oliginvest/i18n";
import { Button, ErrorState } from "@oliginvest/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      title={errorMessages.INTERNAL.title}
      action={<Button onClick={reset}>{commonMessages.action.retry}</Button>}
    />
  );
}

"use client";
import {
  commonMessages as defaultCommonMessages,
  errorMessages as defaultErrorMessages,
} from "@oliginvest/i18n";
import { Button, ErrorState } from "@oliginvest/ui";
import { useCopy } from "@oliginvest/ui/localization";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const commonMessages = useCopy("commonMessages", defaultCommonMessages);
  const errorMessages = useCopy("errorMessages", defaultErrorMessages);

  return (
    <ErrorState
      title={errorMessages.INTERNAL.title}
      action={<Button onClick={reset}>{commonMessages.action.retry}</Button>}
    />
  );
}

import {
  disclaimers as defaultDisclaimers,
  errorMessages as defaultErrorMessages,
  messages as defaultMessages,
} from "@oliginvest/i18n";
import {
  AllocationBar,
  AssumptionsBlock,
  Button,
  DataFreshness,
  Disclaimer,
  Disclosure,
  ModalDialog,
  Popover,
  RangeBar,
  SelectField,
  TextField,
} from "@oliginvest/ui";
import { useCopy } from "@oliginvest/ui/localization";
import type * as React from "react";

/** Technical M0 fixture. No user/market data and no product workflow. */
export default function UiPreviewPage(): React.JSX.Element {
  const disclaimers = useCopy("disclaimers", defaultDisclaimers);
  const errorMessages = useCopy("errorMessages", defaultErrorMessages);
  const messages = useCopy("messages", defaultMessages);

  return (
    <main className="mx-auto grid max-w-prose gap-5 px-4 py-8">
      <h1 className="font-sans text-2xl font-semibold">{messages.bootstrap.title}</h1>
      <p>{messages.bootstrap.description}</p>
      <TextField
        id="preview-price"
        label={messages.col.price}
        inputMode="decimal"
        defaultValue="1234.56"
      />
      <TextField id="preview-date" label={messages.col.date} type="date" />
      <TextField
        id="preview-quantity"
        label={messages.col.quantity}
        error={errorMessages.VALIDATION_FAILED.title}
        inputMode="decimal"
      />
      <SelectField id="preview-theme" label={messages.bootstrap.themeLabel}>
        <option value="dark">{messages.bootstrap.themes.dark}</option>
        <option value="light">{messages.bootstrap.themes.light}</option>
      </SelectField>
      <Button>{messages.action.save}</Button>
      <AllocationBar
        items={[
          { label: "PLN", weight: 0.75 },
          { label: "EUR", weight: 0.25 },
        ]}
      />
      <RangeBar low="8" high="14" value="12" currency="PLN" />
      <ModalDialog
        title={messages.nav.settings}
        triggerLabel={messages.nav.settings}
        closeLabel={messages.action.cancel}
      >
        <TextField id="dialog-account" label={messages.col.account} />
      </ModalDialog>
      <Popover label={messages.col.note}>
        <p>{disclaimers.demo.text}</p>
      </Popover>
      <Disclosure summary={messages.nav.learn}>
        <p>{disclaimers.education.text}</p>
      </Disclosure>
      <AssumptionsBlock summary={disclaimers.demo.text}>
        <p>{disclaimers.analysis.text}</p>
      </AssumptionsBlock>
      <DataFreshness
        kind="delayed"
        meta={{
          source: "demo",
          asOf: "2026-09-18T13:42:00Z",
          delayMinutes: 20,
          stale: true,
          staleReason: "provider_error",
        }}
      />
      <DataFreshness
        kind="eod"
        sessionDate="2026-09-18"
        meta={{ source: "demo", asOf: "2026-09-18T20:00:00Z", delayMinutes: 0, stale: false }}
      />
      <Disclaimer disclaimerKey="general" version="2026-09" />
      <Disclaimer disclaimerKey="analysis" version="2026-09" />
    </main>
  );
}

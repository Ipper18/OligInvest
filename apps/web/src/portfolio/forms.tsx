"use client";
import { errorMessages, portfolioMessages as m, type ProblemCode } from "@oliginvest/i18n";
import { Button, SelectField, TextField } from "@oliginvest/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { submitAction } from "../auth/actions";
import { mutateResource } from "./actions";
import { readResource } from "./read-action";
import type { Resource } from "./resources";

type Failure = { code: string; requestId: string; fields?: string[] };
export function FormError({ error }: { error: Failure | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  if (!error) return null;
  return (
    <div ref={ref} className="oi-error-summary" role="alert" tabIndex={-1}>
      <p>{errorMessages[error.code as ProblemCode]?.title ?? m.invalid}</p>
      {error.requestId && (
        <p>
          {m.requestId}: {error.requestId}
        </p>
      )}
      {error.fields?.map((field) => (
        <p key={field}>
          <a href={`#field-${field.split(".")[0]}`}>
            {m.invalid} {field}
          </a>
        </p>
      ))}
    </div>
  );
}
export function InstrumentPicker({
  initialId = "",
  onSelect,
}: {
  initialId?: string;
  onSelect?: (id: string) => void;
}) {
  const [id, setId] = useState(initialId),
    [query, setQuery] = useState(""),
    [items, setItems] = useState<Resource<"search">["data"]>([]),
    [failed, setFailed] = useState(false);
  return (
    <fieldset>
      <legend>{m.instrument}</legend>
      <TextField
        id="instrument-query"
        label={m.query}
        value={query}
        maxLength={64}
        onChange={(e) => setQuery(e.target.value)}
      />
      <Button
        onClick={async () => {
          setFailed(false);
          try {
            setItems((await readResource("search", { q: query })).data);
          } catch {
            setFailed(true);
          }
        }}
        disabled={!query.trim()}
      >
        {m.search}
      </Button>
      {failed && <p role="alert">{m.failed}</p>}
      <input type="hidden" id="field-instrumentId" name="instrumentId" value={id} />
      {id && <p>{items.find((item) => item.id === id)?.name ?? id}</p>}
      {items.map((item) => (
        <label key={item.id}>
          <input
            type="radio"
            name="instrument-choice"
            checked={id === item.id}
            onChange={() => {
              setId(item.id);
              onSelect?.(item.id);
            }}
          />
          {item.ticker} {item.name} {item.mic}
        </label>
      ))}
    </fieldset>
  );
}
function TransactionField({
  name,
  required = false,
  mode = "text",
  initial,
  error,
}: {
  name: string;
  required?: boolean;
  mode?: "text" | "date";
  initial: Resource<"transaction"> | undefined;
  error: Failure | null;
}) {
  const value = initial?.[name as keyof typeof initial];
  const numeric = ![
    "note",
    "category",
    "relatedTransactionId",
    "tradeDate",
    "settleDate",
    "acquiredOn",
  ].includes(name);
  return (
    <TextField
      key={name}
      id={`field-${name}`}
      name={name}
      label={
        name === "tradeDate"
          ? m.date
          : name === "tax"
            ? m.withholding
            : (m[name as keyof typeof m] as string)
      }
      type={mode}
      inputMode={numeric ? "decimal" : undefined}
      required={required}
      defaultValue={
        typeof value === "object" && value && "amount" in value
          ? value.amount
          : typeof value === "string" || typeof value === "number"
            ? value
            : ""
      }
      maxLength={name === "note" ? 500 : 64}
      error={error?.fields?.includes(name) ? m.invalid : undefined}
    />
  );
}
export function TransactionForm({
  accounts,
  initial,
}: {
  accounts: Resource<"accounts">["data"];
  initial?: Resource<"transaction">;
}) {
  const [type, setType] = useState<keyof typeof m.types>(initial?.type ?? "BUY");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<Failure | null>(null),
    [deleting, setDeleting] = useState(false);
  const key = useRef<string | null>(null),
    router = useRouter(),
    cache = useQueryClient();
  const instrument = [
    "BUY",
    "SELL",
    "DIVIDEND",
    "SPLIT",
    "SECURITY_TRANSFER_IN",
    "SECURITY_TRANSFER_OUT",
  ].includes(type);
  const quantity = instrument && type !== "SPLIT",
    trade = ["BUY", "SELL", "DIVIDEND"].includes(type);
  const cash = !["BUY", "SELL", "SPLIT", "SECURITY_TRANSFER_IN", "SECURITY_TRANSFER_OUT"].includes(
    type,
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData(event.currentTarget),
        get = (name: string) => String(form.get(name) ?? "").trim();
      const body: Record<string, unknown> = {};
      for (const name of [
        "tradeDate",
        "settleDate",
        "instrumentId",
        "quantity",
        "price",
        "priceCurrency",
        "fxRate",
        "acquiredOn",
        "category",
        "relatedTransactionId",
        "note",
      ]) {
        if (get(name))
          body[name] = ["quantity", "price", "fxRate"].includes(name)
            ? get(name).replace(",", ".")
            : get(name);
      }
      if (body.fxRate) body.fxSource = "manual";
      for (const name of ["ratioFrom", "ratioTo"]) if (get(name)) body[name] = Number(get(name));
      for (const name of [
        "amount",
        "fee",
        "tax",
        "cashInLieu",
        "acquisitionCost",
        "counterAmount",
      ]) {
        if (get(name))
          body[name] = {
            amount: get(name).replace(",", "."),
            currency: get(name === "counterAmount" ? "counterCurrency" : "currency"),
          };
      }
      if (!initial) {
        body.type = type;
        body.accountId = get("accountId");
      }
      key.current ??= crypto.randomUUID();
      const result = await mutateResource({
        kind: "transaction",
        method: deleting ? "DELETE" : initial ? "PATCH" : "POST",
        ...(initial ? { id: initial.id } : {}),
        key: key.current,
        body,
      });
      if (!result.ok) {
        setError(result);
        if (result.code !== "SERVICE_UNAVAILABLE") key.current = null;
        return;
      }
      await cache.invalidateQueries();
      router.push("/portfel/operacje");
      router.refresh();
    } catch {
      setError({ code: "SERVICE_UNAVAILABLE", requestId: "" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="oi-domain-form" onSubmit={submit}>
      <FormError error={error} />
      <SelectField
        id="field-accountId"
        name="accountId"
        label={m.account}
        defaultValue={initial?.accountId ?? accounts[0]?.id}
        disabled={Boolean(initial)}
        required
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        id="field-type"
        label={m.type}
        value={type}
        disabled={Boolean(initial)}
        onChange={(e) => setType(e.target.value as keyof typeof m.types)}
      >
        {Object.entries(m.types).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </SelectField>
      <TransactionField name="tradeDate" initial={initial} error={error} required mode="date" />
      <TransactionField name="settleDate" initial={initial} error={error} mode="date" />
      {instrument && <InstrumentPicker initialId={initial?.instrumentId ?? ""} />}
      {quantity && <TransactionField name="quantity" initial={initial} error={error} required />}
      {trade && (
        <>
          <TransactionField name="price" initial={initial} error={error} required />
          <SelectField
            id="field-priceCurrency"
            name="priceCurrency"
            label={m.currency}
            defaultValue={initial?.priceCurrency ?? "PLN"}
          >
            {["PLN", "USD", "EUR"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </SelectField>
        </>
      )}
      {cash && <TransactionField name="amount" initial={initial} error={error} required />}
      <SelectField
        id="field-currency"
        name="currency"
        label={m.currency}
        defaultValue={initial?.amount.currency ?? accounts[0]?.currency ?? "PLN"}
      >
        {["PLN", "USD", "EUR"].map((c) => (
          <option key={c}>{c}</option>
        ))}
      </SelectField>
      {trade && (
        <>
          <TransactionField name="fee" initial={initial} error={error} />
          <TransactionField name="tax" initial={initial} error={error} />
          <TransactionField name="fxRate" initial={initial} error={error} />
        </>
      )}
      {type === "SPLIT" && (
        <>
          <TransactionField name="ratioFrom" initial={initial} error={error} required />
          <TransactionField name="ratioTo" initial={initial} error={error} required />
          <TransactionField name="cashInLieu" initial={initial} error={error} />
        </>
      )}
      {type === "SECURITY_TRANSFER_IN" && (
        <>
          <TransactionField name="acquisitionCost" initial={initial} error={error} />
          <TransactionField name="acquiredOn" initial={initial} error={error} mode="date" />
        </>
      )}
      {type === "FX_CONVERSION" && (
        <>
          <TransactionField name="counterAmount" initial={initial} error={error} required />
          <SelectField
            id="field-counterCurrency"
            name="counterCurrency"
            label={m.counterCurrency}
            defaultValue={initial?.counterAmount?.currency ?? "USD"}
          >
            {["PLN", "USD", "EUR"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </SelectField>
        </>
      )}
      <TransactionField name="relatedTransactionId" initial={initial} error={error} />
      {type === "ADJUSTMENT" && (
        <TransactionField name="category" initial={initial} error={error} required />
      )}
      <TransactionField name="note" initial={initial} error={error} />
      {deleting && (
        <p role="alert">
          {m.confirmDelete}: {initial?.tradeDate} {m.types[type]}
        </p>
      )}
      <div className="oi-actions">
        <Button type="submit" disabled={busy || !accounts.length}>
          {busy ? m.saving : deleting ? m.confirmDelete : m.save}
        </Button>
        {initial && (
          <Button onClick={() => setDeleting(!deleting)} disabled={busy}>
            {deleting ? m.cancel : m.delete}
          </Button>
        )}
      </div>
    </form>
  );
}
export function AccountForm({ initial }: { initial?: Resource<"account"> }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<Failure | null>(null),
    [deleting, setDeleting] = useState(false);
  const key = useRef<string | null>(null),
    router = useRouter(),
    cache = useQueryClient();
  return (
    <form
      className="oi-domain-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          const form = new FormData(event.currentTarget),
            get = (name: string) => String(form.get(name) ?? "");
          if (deleting) {
            const step = await submitAction("stepUp", { code: get("code") });
            if (!step.ok) {
              setError(step);
              return;
            }
          }
          const body = initial
            ? { name: get("name"), accountType: get("accountType") }
            : {
                name: get("name"),
                accountType: get("accountType"),
                broker: get("broker"),
                currency: get("currency"),
              };
          key.current ??= crypto.randomUUID();
          const result = await mutateResource({
            kind: "account",
            method: deleting ? "DELETE" : initial ? "PATCH" : "POST",
            ...(initial ? { id: initial.id } : {}),
            key: key.current,
            body,
          });
          if (!result.ok) {
            setError(result);
            if (result.code !== "SERVICE_UNAVAILABLE") key.current = null;
            return;
          }
          await cache.invalidateQueries();
          router.push("/portfel/rachunki");
          router.refresh();
        } catch {
          setError({ code: "SERVICE_UNAVAILABLE", requestId: "" });
        } finally {
          setBusy(false);
        }
      }}
    >
      <FormError error={error} />
      <TextField
        id="field-name"
        name="name"
        label={m.name}
        required
        maxLength={60}
        defaultValue={initial?.name ?? ""}
      />
      {!initial && (
        <>
          <SelectField id="field-broker" name="broker" label={m.broker}>
            {(["xtb", "mbank", "other"] as const).map((b) => (
              <option value={b} key={b}>
                {m[b]}
              </option>
            ))}
          </SelectField>
          <SelectField id="field-currency" name="currency" label={m.currency}>
            {["PLN", "USD", "EUR"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </SelectField>
        </>
      )}
      <SelectField
        id="field-accountType"
        name="accountType"
        label={m.accountType}
        defaultValue={initial?.accountType ?? "regular"}
      >
        {(["regular", "ike", "ikze"] as const).map((type) => (
          <option key={type} value={type}>
            {m[type]}
          </option>
        ))}
      </SelectField>
      {deleting && (
        <>
          <p>
            {m.deleteAccountHelp} {initial?.name}
          </p>
          <TextField
            id="step-code"
            name="code"
            label={m.stepUp}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            required
          />
        </>
      )}
      <div className="oi-actions">
        <Button type="submit" disabled={busy}>
          {busy ? m.saving : deleting ? m.confirmDelete : m.save}
        </Button>
        {initial && (
          <Button disabled={busy} onClick={() => setDeleting(!deleting)}>
            {deleting ? m.cancel : m.delete}
          </Button>
        )}
      </div>
    </form>
  );
}

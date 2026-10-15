"use client";
import { formatDateTime, formatQuantity, portfolioMessages as m } from "@oliginvest/i18n";
import { Button, Disclosure, SelectField, TextField } from "@oliginvest/ui";
import { DataTable } from "@oliginvest/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { mutateResource, uploadFile } from "./actions";
import { FormError, InstrumentPicker } from "./forms";
import { Amount } from "./presentation";
import { QueryNotice, useResource } from "./query";
import type { ReadArgs, Resource } from "./resources";
import { PageLinks } from "./screens";

const statusLabel = (s: string) =>
  s === "failed" ? m.failedImport : (m[s as keyof typeof m] as string);
export function ImportUpload({
  userId,
  accounts,
  initial,
  mbank,
}: {
  userId: string;
  accounts: Resource<"accounts">["data"];
  initial: Resource<"imports">;
  mbank: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<{ code: string; requestId: string } | null>(null);
  const [source, setSource] = useState("xtb");
  const key = useRef<string | null>(null),
    router = useRouter();
  const query = useResource(userId, "imports", {}, initial);
  return (
    <>
      <form
        className="oi-domain-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(null);
          const form = new FormData(e.currentTarget);
          key.current ??= crypto.randomUUID();
          form.set("key", key.current);
          try {
            const result = await uploadFile(form);
            if (result.ok) {
              router.push(`/portfel/import/${result.id}`);
            } else {
              setError(result);
              if (result.code !== "SERVICE_UNAVAILABLE") key.current = null;
            }
          } catch {
            setError({ code: "SERVICE_UNAVAILABLE", requestId: "" });
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormError error={error} />
        <SelectField
          id="import-source"
          name="source"
          label={m.broker}
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            key.current = null;
          }}
        >
          <option value="xtb">{m.xtb}</option>
          {mbank && <option value="mbank">{m.mbank}</option>}
        </SelectField>
        <p>{source === "mbank" ? m.mbankExportHelp : m.exportHelp}</p>

        <SelectField
          key={source}
          id="import-account"
          name="accountId"
          label={m.account}
          required
          onChange={() => {
            key.current = null;
          }}
        >
          {accounts
            .filter((a) => a.broker === source && !a.closedOn)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </SelectField>
        <TextField
          id="import-file"
          name="file"
          type="file"
          accept={source === "mbank" ? ".csv" : ".csv,.xlsx"}
          label={m.file}
          required
          onChange={() => {
            key.current = null;
          }}
        />
        <Button
          type="submit"
          disabled={busy || !accounts.some((a) => a.broker === source && !a.closedOn)}
        >
          {busy ? m.saving : m.upload}
        </Button>
      </form>
      <QueryNotice failed={query.isError} retry={query.refetch} />
      <DataTable
        caption={m.imports}
        headings={[m.file, m.status, m.date]}
        rows={query.data.data.map((batch) => ({
          id: batch.id,
          cells: [
            <Link key="batch" href={`/portfel/import/${batch.id}`}>
              {batch.fileName}
            </Link>,
            statusLabel(batch.status),
            formatDateTime(batch.createdAt),
          ],
        }))}
      />
      <PageLinks page={query.data.page} args={{}} />
    </>
  );
}

function RowEditor({
  row,
  run,
}: {
  row: Resource<"rows">["data"][number];
  run: (kind: "row", body: unknown, rowId: string) => Promise<void>;
}) {
  const [action, setAction] = useState("map_instrument");
  return (
    <form
      className="oi-domain-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget),
          get = (key: string) => String(f.get(key) ?? "").trim();
        const fields: Record<string, unknown> = {};
        if (get("amount"))
          fields.amount = { amount: get("amount").replace(",", "."), currency: get("currency") };
        if (get("fxRate")) {
          fields.fxRate = get("fxRate").replace(",", ".");
          fields.fxSource = "manual";
        }
        await run(
          "row",
          {
            action,
            ...(action === "map_instrument" ? { instrumentId: get("instrumentId") } : {}),
            ...(Object.keys(fields).length ? { fields } : {}),
            rememberMapping: f.get("remember") === "on",
          },
          row.id,
        );
      }}
    >
      <SelectField
        id="resolution-action"
        label={m.resolution}
        value={action}
        onChange={(e) => setAction(e.target.value)}
      >
        <option value="map_instrument">{m.map}</option>
        <option value="skip">{m.skip}</option>
        <option value="include">{m.include}</option>
      </SelectField>
      {action === "map_instrument" && <InstrumentPicker initialId={row.instrumentId ?? ""} />}
      {action !== "skip" && (
        <>
          <TextField id="resolution-amount" name="amount" label={m.amount} inputMode="decimal" />
          <SelectField id="resolution-currency" name="currency" label={m.currency}>
            {["PLN", "USD", "EUR"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </SelectField>
          <TextField id="resolution-fx" name="fxRate" label={m.fxRate} inputMode="decimal" />
          <label>
            <input name="remember" type="checkbox" defaultChecked />
            {m.rememberMapping}
          </label>
        </>
      )}
      <Button type="submit">{m.save}</Button>
    </form>
  );
}

export function ImportPreview({
  userId,
  args,
  initial,
  initialRows,
}: {
  userId: string;
  args: ReadArgs;
  initial: Resource<"import">;
  initialRows: Resource<"rows">;
}) {
  const query = useResource(userId, "import", { id: initial.id }, initial),
    rows = useResource(userId, "rows", args, initialRows);
  const batch = query.data,
    counts = batch.summary?.byStatus ?? {};
  const [busy, setBusy] = useState(false),
    [ack, setAck] = useState(false),
    [discard, setDiscard] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState<{ code: string; requestId: string } | null>(null);
  const cache = useQueryClient(),
    router = useRouter(),
    key = useRef<string | null>(null);
  const editable = batch.status === "parsed",
    unresolved = (counts.error ?? 0) + (counts.needs_mapping ?? 0) > 0;
  async function run(kind: "row" | "commit" | "import", body: unknown, rowId?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    key.current ??= crypto.randomUUID();
    try {
      const result = await mutateResource({
        kind,
        method: kind === "row" ? "PATCH" : kind === "commit" ? "POST" : "DELETE",
        id: batch.id,
        ...(rowId ? { rowId } : {}),
        key: key.current,
        body,
      });
      if (!result.ok) {
        setError(result);
        if (result.code !== "SERVICE_UNAVAILABLE") key.current = null;
        return;
      }
      key.current = null;
      setSelected(null);
      await cache.invalidateQueries({ queryKey: [userId, "portfolio"] });
      if (kind === "commit") router.push("/portfel");
      else if (kind === "import") router.push("/portfel/import");
      router.refresh();
    } catch {
      setError({ code: "SERVICE_UNAVAILABLE", requestId: "" });
    } finally {
      setBusy(false);
    }
  }
  const row = rows.data.data.find((r) => r.id === selected);
  return (
    <>
      <QueryNotice
        failed={query.isError || rows.isError}
        retry={() => {
          void query.refetch();
          return rows.refetch();
        }}
      />
      <FormError error={error} />
      <p role="status">{statusLabel(batch.status)}</p>
      <p>{batch.fileName}</p>
      {batch.error && <p role="alert">{batch.error}</p>}
      <DataTable
        caption={m.summary}
        headings={[m.status, m.rowCount]}
        rows={Object.entries(counts).map(([status, count]) => ({
          id: status,
          cells: [statusLabel(status), count],
        }))}
      />
      <form method="get" className="oi-filters">
        <SelectField
          id="rows-status"
          name="status"
          label={m.status}
          defaultValue={args.status ?? "unresolved"}
        >
          {(
            [
              "unresolved",
              "all",
              "new",
              "duplicate",
              "unsupported",
              "needs_mapping",
              "error",
              "skipped",
            ] as const
          ).map((s) => (
            <option key={s} value={s}>
              {m[s]}
            </option>
          ))}
        </SelectField>
        <Button type="submit">{m.apply}</Button>
      </form>
      <DataTable
        caption={m.preview}
        headings={[m.row, m.status, m.reason, m.raw, m.resolution]}
        rows={rows.data.data.map((r) => ({
          id: r.id,
          cells: [
            r.rowNumber,
            statusLabel(r.status),
            r.statusReason ?? m.not_applicable,
            <Disclosure key="raw" summary={m.raw}>
              <dl>
                {Object.entries(r.raw).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v ?? m.unavailable}</dd>
                  </div>
                ))}
              </dl>
            </Disclosure>,
            editable ? (
              <Button key="edit" disabled={busy} onClick={() => setSelected(r.id)}>
                {m.edit}
              </Button>
            ) : (
              m.not_applicable
            ),
          ],
        }))}
      />
      <PageLinks page={rows.data.page} args={{ ...args, id: undefined }} />
      {row && editable && (
        <fieldset disabled={busy}>
          <legend>
            {m.row} {row.rowNumber}
          </legend>
          <RowEditor key={row.id} row={row} run={run} />
        </fieldset>
      )}
      <h2>{m.reconciliation}</h2>
      {!batch.reconciliation?.cash?.length && !batch.reconciliation?.positions?.length && (
        <p>{m.noReconciliation}</p>
      )}
      <DataTable
        caption={m.cash}
        headings={[m.currency, m.expected, m.computed, m.difference]}
        rows={(batch.reconciliation?.cash ?? []).map((r) => ({
          id: r.currency,
          cells: [
            r.currency,
            <Amount key="expected" value={r.expected} />,
            <Amount key="computed" value={r.computed} />,
            <Amount key="difference" value={r.difference} signed />,
          ],
        }))}
      />
      <DataTable
        caption={m.positions}
        headings={[m.instrument, m.expected, m.computed]}
        rows={(batch.reconciliation?.positions ?? []).map((r) => ({
          id: r.instrumentId,
          cells: [
            r.instrumentId,
            formatQuantity(r.expectedQuantity),
            formatQuantity(r.computedQuantity),
          ],
        }))}
      />
      {editable && (
        <>
          {unresolved && <p>{m.unresolved}</p>}
          {batch.reconciliation?.ok !== true && (
            <label>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              {m.acknowledgeDifferences}
            </label>
          )}
          <Button
            disabled={busy || unresolved || (batch.reconciliation?.ok !== true && !ack)}
            onClick={() => void run("commit", { acknowledgeDifferences: ack })}
          >
            {m.commit}
          </Button>
        </>
      )}
      {!["committed", "discarded"].includes(batch.status) && (
        <>
          <Button disabled={busy} onClick={() => setDiscard(!discard)}>
            {m.discard}
          </Button>
          {discard && (
            <div role="alert">
              <p>
                {m.confirmDiscard} {batch.fileName}
              </p>
              <Button disabled={busy} onClick={() => void run("import", undefined)}>
                {m.confirmDelete}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

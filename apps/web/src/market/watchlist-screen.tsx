"use client";
import { marketMessages as m, portfolioMessages as p } from "@oliginvest/i18n";
import { Disclaimer } from "@oliginvest/ui";
import { DataTable } from "@oliginvest/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { FormError, InstrumentPicker } from "../portfolio/forms";
import { Amount, Freshness, ratio } from "../portfolio/presentation";
import { QueryNotice, useResource } from "../portfolio/query";
import type { Resource } from "../portfolio/resources";
import { mutateWatchlist } from "./watchlist-actions";

function useWatchlistMutation(userId: string) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState<{ code: string; requestId: string } | null>(null);
  // A save is complete only once the refreshed server view is rendered; until then the controls
  // stay disabled, so a reload or the next action never interrupts the refresh.
  const [refreshing, startRefresh] = useTransition();
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const cache = useQueryClient(),
    router = useRouter();
  const run = async (
    action: Parameters<typeof mutateWatchlist>[0],
    args: Parameters<typeof mutateWatchlist>[1],
  ) => {
    if (pending || refreshing) return false;
    const signature = JSON.stringify([action, args]);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    setPending(true);
    setError(null);
    try {
      const result = await mutateWatchlist(action, { ...args, key: attempt.current.key });
      if (!result.ok) {
        setError(result);
        return false;
      }
      attempt.current = null;
      await cache.invalidateQueries({ queryKey: [userId, "market"] });
      startRefresh(() => router.refresh());
      return true;
    } catch {
      setError({ code: "SERVICE_UNAVAILABLE", requestId: "" });
      return false;
    } finally {
      setPending(false);
    }
  };
  return { pending: pending || refreshing, error, run };
}
export function WatchlistsScreen({
  userId,
  initial,
}: {
  userId: string;
  initial: Resource<"watchlists">;
}) {
  const lists = useResource(userId, "watchlists", {}, initial),
    mutation = useWatchlistMutation(userId);
  return (
    <>
      <QueryNotice failed={lists.isError} retry={lists.refetch} />
      <FormError error={mutation.error} />
      <form
        className="oi-filters"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          if (await mutation.run("create", { input: { name: new FormData(form).get("name") } }))
            form.reset();
        }}
      >
        <label>
          {m.listName}
          <input name="name" required maxLength={40} />
        </label>
        <button type="submit" className="oi-button" disabled={mutation.pending}>
          {m.createList}
        </button>
      </form>
      <ul>
        {lists.data.data.map((list, index) => (
          <li key={list.id}>
            <Link href={`/rynek/watchlisty/${list.id}`}>{list.name}</Link>
            <button
              type="button"
              className="oi-button"
              disabled={mutation.pending || index === 0}
              onClick={() =>
                void mutation.run("update", { id: list.id, input: { position: index - 1 } })
              }
            >
              {m.up}
            </button>
            <button
              type="button"
              className="oi-button"
              disabled={mutation.pending || index === lists.data.data.length - 1}
              onClick={() =>
                void mutation.run("update", { id: list.id, input: { position: index + 1 } })
              }
            >
              {m.downOrder}
            </button>
            <details>
              <summary>
                {m.deleteList} {list.name}
              </summary>
              <button
                type="button"
                className="oi-button"
                disabled={mutation.pending}
                onClick={() => void mutation.run("remove", { id: list.id, input: {} })}
              >
                {m.confirmDelete}
              </button>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}
export function WatchlistScreen({
  userId,
  initial,
}: {
  userId: string;
  initial: Resource<"watchlist">;
}) {
  const list = useResource(userId, "watchlist", { id: initial.id }, initial),
    mutation = useWatchlistMutation(userId);
  return (
    <>
      <h1>{list.data.name}</h1>
      <QueryNotice failed={list.isError} retry={list.refetch} />
      <FormError error={mutation.error} />
      <form
        className="oi-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void mutation.run("update", {
            id: initial.id,
            input: { name: new FormData(event.currentTarget).get("name") },
          });
        }}
      >
        <label>
          {m.listName}
          <input name="name" required maxLength={40} defaultValue={list.data.name} />
        </label>
        <button type="submit" className="oi-button" disabled={mutation.pending}>
          {p.save}
        </button>
      </form>
      <form
        className="oi-form"
        onSubmit={(event) => {
          event.preventDefault();
          void mutation.run("addItem", {
            id: initial.id,
            input: { instrumentId: new FormData(event.currentTarget).get("instrumentId") },
          });
        }}
      >
        <InstrumentPicker />
        <button type="submit" className="oi-button" disabled={mutation.pending}>
          {m.addInstrument}
        </button>
      </form>
      <DataTable
        caption={m.watchlists}
        headings={[p.instrument, p.price, p.dayChange, p.status, m.note, m.actions]}
        rows={list.data.items.map((item, index) => ({
          id: item.instrument.id,
          cells: [
            <Link key="link" prefetch={false} href={`/rynek/${item.instrument.id}`}>
              {item.instrument.ticker}
            </Link>,
            item.quote ? (
              <Amount
                key="price"
                value={{ amount: item.quote.price, currency: item.quote.currency }}
              />
            ) : (
              m.noQuote
            ),
            ratio(item.quote?.changeRatio),
            item.quote ? <Freshness key="meta" meta={item.quote.meta} /> : m.noQuote,
            <form
              key="note"
              onSubmit={(event) => {
                event.preventDefault();
                void mutation.run("updateItem", {
                  id: initial.id,
                  instrumentId: item.instrument.id,
                  input: { note: new FormData(event.currentTarget).get("note") },
                });
              }}
            >
              <label>
                {m.note} {item.instrument.ticker}
                <input name="note" maxLength={280} defaultValue={item.note} />
              </label>
              <button type="submit" className="oi-button" disabled={mutation.pending}>
                {m.saveNote}
              </button>
            </form>,
            <div key="actions">
              <button
                type="button"
                className="oi-button"
                disabled={mutation.pending || index === 0}
                onClick={() =>
                  void mutation.run("updateItem", {
                    id: initial.id,
                    instrumentId: item.instrument.id,
                    input: { position: index - 1 },
                  })
                }
              >
                {m.up}
              </button>
              <button
                type="button"
                className="oi-button"
                disabled={mutation.pending || index === list.data.items.length - 1}
                onClick={() =>
                  void mutation.run("updateItem", {
                    id: initial.id,
                    instrumentId: item.instrument.id,
                    input: { position: index + 1 },
                  })
                }
              >
                {m.downOrder}
              </button>
              <details>
                <summary>
                  {m.deleteInstrument} {item.instrument.ticker}
                </summary>
                <button
                  type="button"
                  className="oi-button"
                  disabled={mutation.pending}
                  onClick={() =>
                    void mutation.run("removeItem", {
                      id: initial.id,
                      instrumentId: item.instrument.id,
                      input: {},
                    })
                  }
                >
                  {m.confirmDelete}
                </button>
              </details>
            </div>,
          ],
        }))}
      />
      <Disclaimer disclaimerKey="data_delay" version="2026-09" />
    </>
  );
}

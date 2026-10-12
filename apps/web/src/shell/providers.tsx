"use client";
import { appMessages } from "@oliginvest/i18n";
import { AppShell, Button } from "@oliginvest/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Me } from "../api/validation";
import { submitAction } from "../auth/actions";
import { clearPrivateState, onLogout } from "../auth/logout";
import { connectStream, type StreamState } from "../sse/transport";
import { Navigation } from "./navigation";
export const queryKey = (userId: string, ...parts: unknown[]) => [userId, ...parts];
export function Providers({
  initialMe,
  children,
  footer,
}: {
  initialMe: Me;
  children: ReactNode;
  footer: ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  const [me, setMe] = useState(initialMe);
  const [state, setState] = useState<StreamState>("paused");
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const stream = useRef<ReturnType<typeof connectStream> | null>(null);
  const router = useRouter();
  useEffect(() => {
    setMe(initialMe);
    client.setQueryData(queryKey(initialMe.id, "me"), initialMe);
  }, [client, initialMe]);
  useEffect(() => {
    let disposed = false;

    const refresh = () => {
      void client.invalidateQueries({
        predicate: (q) => q.queryKey[0] === me.id && Date.now() - q.state.dataUpdatedAt > 60000,
      });
      router.refresh();
    };
    const logout = () => {
      stream.current?.stop();
      client.clear();
      void clearPrivateState(false).finally(() => {
        location.replace("/logowanie");
      });
    };
    const unsubscribe = onLogout(() => {
      stream.current?.stop();
      client.clear();
    });
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("oliginvest-session")
        : undefined;
    if (channel)
      channel.onmessage = (e) => {
        if (e.data === "logout") logout();
      };
    // Validation is loaded outside the initial shell bundle; no Zod runtime in initial JS.
    void import("@oliginvest/contracts/realtime")
      .then(({ realtimeSchemas }) => {
        if (disposed) return;
        stream.current = connectStream({
          initiallyPaused: pausedRef.current,
          state: setState,
          resume: refresh,
          unauthorized: logout,
          frame: async (frame) => {
            if (!Object.hasOwn(realtimeSchemas, frame.event)) return;
            const schema = realtimeSchemas[frame.event as keyof typeof realtimeSchemas];
            const event = schema.parse(JSON.parse(frame.data));
            const data = event as unknown as Record<string, unknown>;
            if ((frame.event === "ready" && data.resumed === false) || frame.event === "resync")
              void client.invalidateQueries({ queryKey: [me.id] });
            if (frame.event === "flags.changed") {
              await client.invalidateQueries({ queryKey: queryKey(me.id, "me") });
              router.refresh();
            }
            if (frame.event === "market.quotes.updated")
              for (const quote of data.quotes as { instrumentId: string }[])
                client.setQueryData(queryKey(me.id, "market", "quote", quote.instrumentId), quote);
            if (frame.event === "portfolio.valuation.updated") {
              if (data.reason === "quotes" && data.summary)
                client.setQueryData(
                  queryKey(me.id, "portfolio", "summary"),
                  (previous: Record<string, unknown> | undefined) =>
                    previous
                      ? { ...previous, ...(data.summary as Record<string, unknown>) }
                      : undefined,
                );
              else void client.invalidateQueries({ queryKey: queryKey(me.id, "portfolio") });
            }
            if (frame.event === "portfolio.import.parsed")
              void client.invalidateQueries({
                queryKey: queryKey(me.id, "portfolio", "import", data.importId),
              });
            if (frame.event.startsWith("analytics.run."))
              void client.invalidateQueries({ queryKey: queryKey(me.id, "analytics", data.runId) });
            if (frame.event === "identity.export.ready")
              void client.invalidateQueries({
                queryKey: queryKey(me.id, "identity", "export", data.exportId),
              });
            if (frame.event === "alerts.alert.triggered")
              void client.invalidateQueries({ queryKey: queryKey(me.id, "alerts") });
          },
        });
      })
      .catch(() => {
        if (!disposed) setState("polling");
      });
    return () => {
      disposed = true;
      stream.current?.stop();
      unsubscribe();
      channel?.close();
      client.clear();
    };
  }, [client, me.id, router]);
  useEffect(() => {
    if (state !== "polling" && state !== "offline") return;
    let tick = 0;
    const interval = setInterval(() => {
      if (document.hidden) return;
      tick += 5;
      void client.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === me.id &&
          q.getObserversCount() > 0 &&
          (q.meta?.pollSeconds === 5 || tick % 60 === 0),
      });
      if (tick % 60 === 0) router.refresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [client, state, me.id, router]);
  return (
    <QueryClientProvider client={client}>
      <AppShell
        footer={footer}
        navigation={<Navigation me={me} />}
        toolbar={
          <div className="oi-toolbar">
            <span role="status" className="oi-connection">
              {appMessages[state]}
            </span>
            <Button
              onClick={() => {
                setPaused(!paused);
                pausedRef.current = !paused;
                stream.current?.pause(!paused);
              }}
            >
              {paused ? appMessages.resume : appMessages.pause}
            </Button>
            <Button
              onClick={async () => {
                await clearPrivateState();
                await submitAction("signOut", {});
                location.replace("/logowanie");
              }}
            >
              {appMessages.signOut}
            </Button>
          </div>
        }
      >
        {children}
      </AppShell>
    </QueryClientProvider>
  );
}

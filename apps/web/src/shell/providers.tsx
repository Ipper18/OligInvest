"use client";
import { appMessages } from "@oliginvest/i18n";
import { AppShell, Button } from "@oliginvest/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Me } from "../api/validation";
import { submitAction } from "../auth/actions";
import { clearPrivateState, onLogout, onRemoteLogout } from "../auth/logout";
import { updateImportCache, updatePortfolioCache } from "../portfolio/stream-cache";
import { connectStream, type StreamState } from "../sse/transport";
import { connectionStatus } from "./connection-status";
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
  const [leaving, setLeaving] = useState(false);
  const pausedRef = useRef(false);
  const stream = useRef<ReturnType<typeof connectStream> | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const educationEnabled =
    me.features["module.education"] !== false && me.permissions.includes("education:use");
  useEffect(() => {
    if (!me.id || !educationEnabled) return;
    let alive = true,
      dispose = () => {};
    const timer = setTimeout(() => {
      void import("../education/onboarding")
        .then((module) => module.startOnboarding(false, () => alive))
        .then((cleanup) => {
          dispose = cleanup;
          if (!alive) cleanup();
        })
        .catch(() => {});
    }, 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
      dispose();
    };
  }, [me.id, educationEnabled]);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  useEffect(() => {
    if (!connectionId) return;
    const id = /^\/rynek\/([0-9a-f-]{36})$/i.exec(pathname)?.[1];
    const abort = new AbortController();
    void fetch(`/api/v1/stream/connections/${connectionId}/instruments`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instrumentIds: id ? [id] : [] }),
      signal: abort.signal,
    })
      .then((response) => {
        if (!response.ok) setState("polling");
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("polling");
      });
    return () => abort.abort();
  }, [connectionId, pathname]);
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
      setLeaving(true);
      disposed = true;
      stream.current?.stop();
      client.clear();
      void clearPrivateState(false).finally(() => {
        location.replace("/logowanie");
      });
    };
    const unsubscribe = onLogout(() => {
      setLeaving(true);
      disposed = true;
      stream.current?.stop();
      client.clear();
    });
    const unsubscribeRemote = onRemoteLogout(logout);
    // Validation is loaded outside the initial shell bundle; no Zod runtime in initial JS.
    void import("@oliginvest/contracts/realtime/browser")
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
            if (frame.event === "ready") setConnectionId(data.connectionId as string);
            if ((frame.event === "ready" && data.resumed === false) || frame.event === "resync")
              void client.invalidateQueries({ queryKey: [me.id] });
            if (frame.event === "flags.changed") {
              await client.invalidateQueries({ queryKey: queryKey(me.id, "me") });
              router.refresh();
            }
            if (frame.event === "market.quotes.updated") {
              void client.invalidateQueries({ queryKey: queryKey(me.id, "market") });
              for (const quote of data.quotes as { instrumentId: string }[])
                client.setQueryData(queryKey(me.id, "market", "quote", quote.instrumentId), quote);
            }
            if (frame.event === "portfolio.valuation.updated")
              updatePortfolioCache(
                client,
                me.id,
                data as unknown as Parameters<typeof updatePortfolioCache>[2],
              );
            if (frame.event === "portfolio.import.parsed")
              updateImportCache(client, me.id, data.importId as string);
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
      unsubscribeRemote();
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
  if (leaving) return null;
  return (
    <QueryClientProvider client={client}>
      <AppShell
        footer={footer}
        navigation={<Navigation me={me} />}
        toolbar={
          <div className="oi-toolbar">
            <span role="status" className="oi-connection">
              {appMessages[connectionStatus(state, paused)]}
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
                await clearPrivateState(false);
                await submitAction("signOut", {});
                await clearPrivateState();
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

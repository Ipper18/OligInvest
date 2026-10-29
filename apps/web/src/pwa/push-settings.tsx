"use client";
import { pwaMessages as t } from "@oliginvest/i18n";
import { Button } from "@oliginvest/ui";
import { useEffect, useState } from "react";
import { clearPrivateState } from "../auth/logout";

export function PushSettings({ publicKey }: { publicKey: string | null }) {
  const [available, setAvailable] = useState(false),
    [install, setInstall] = useState(false),
    [active, setActive] = useState(false),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone =
      matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone;
    setInstall(Boolean(ios && !standalone));
    setAvailable(
      Boolean(
        publicKey &&
          "serviceWorker" in navigator &&
          "PushManager" in window &&
          "Notification" in window &&
          (!ios || standalone),
      ),
    );
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .getRegistration()
        .then((r) => r?.pushManager?.getSubscription())
        .then((s) => setActive(Boolean(s)))
        .catch(() => {});
  }, [publicKey]);
  const request = async (path: string, method: string, body?: unknown) => {
    const response = await fetch(`/api/v1/notifications/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401) {
      await clearPrivateState();
      location.replace("/logowanie?returnTo=%2Fustawienia");
    }
    if (!response.ok) throw new Error("PUSH_REQUEST_FAILED");
    if (response.status === 204 || response.status === 202) return null;
    const { pushResponseSchema } = await import("./push-response");
    return pushResponseSchema.parse(await response.json());
  };
  const registration = () => navigator.serviceWorker.ready;
  const save = async (subscription: PushSubscription) => {
    const json = subscription.toJSON();
    return request("push-subscriptions", "POST", {
      endpoint: json.endpoint,
      expirationTime: json.expirationTime ?? null,
      keys: json.keys,
    });
  };
  const run = async (work: () => Promise<void>) => {
    setPending(true);
    setMessage("");
    try {
      await work();
    } catch {
      setMessage(t.error);
    } finally {
      setPending(false);
    }
  };
  return (
    <section aria-labelledby="push-heading" className="oi-form">
      <h2 id="push-heading">{t.notifications}</h2>
      <p>{t.consent}</p>
      {install ? <p>{t.installFirst}</p> : !available ? <p>{t.unavailable}</p> : null}
      <div className="oi-toolbar">
        <Button
          disabled={!available || pending || active}
          onClick={() => {
            // Permission request remains directly in the user gesture, before any asynchronous work.
            const permission = Notification.requestPermission();
            void run(async () => {
              if ((await permission) !== "granted") {
                setMessage(t.denied);
                return;
              }
              const worker = await registration();
              const bytes = Uint8Array.from(
                atob(publicKey!.replaceAll("-", "+").replaceAll("_", "/")),
                (c) => c.charCodeAt(0),
              );
              const subscription =
                (await worker.pushManager.getSubscription()) ??
                (await worker.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: bytes,
                }));
              try {
                await save(subscription);
              } catch (error) {
                await subscription.unsubscribe();
                throw error;
              }
              setActive(true);
              setMessage(t.enabled);
            });
          }}
        >
          {t.enable}
        </Button>
        <Button
          disabled={!available || pending || !active}
          onClick={() =>
            void run(async () => {
              const subscription = await (await registration()).pushManager.getSubscription();
              if (!subscription) throw new Error("PUSH_UNAVAILABLE");
              const saved = await save(subscription);
              await request(`push-subscriptions/${saved!.id}/test`, "POST");
              setMessage(t.sent);
            })
          }
        >
          {t.test}
        </Button>
        <Button
          disabled={pending || !active}
          onClick={() =>
            void run(async () => {
              const subscription = await (await registration()).pushManager.getSubscription();
              if (subscription) {
                const saved = await save(subscription);
                await request(`push-subscriptions/${saved!.id}`, "DELETE");
                await subscription.unsubscribe();
              }
              setActive(false);
              setMessage(t.disabled);
            })
          }
        >
          {t.disable}
        </Button>
      </div>
      <p role="status">{message}</p>
    </section>
  );
}

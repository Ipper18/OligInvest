"use client";
import { formatMessage } from "@oliginvest/i18n";
import { privacyMessages as defaultT } from "@oliginvest/i18n/privacy";
import { Button, TextField } from "@oliginvest/ui";
import { useCopy, useFormatters } from "@oliginvest/ui/localization";
import { useEffect, useRef, useState } from "react";
import { submitAction } from "../auth/actions";
import { clearPrivateState } from "../auth/logout";

/**
 * GDPR rights in settings (BL-114, prywatnosc-rodo.md § 7): export with a one-time download and
 * account deletion after 14 days. Loaded lazily on /ustawienia only (R-53). Responses are checked
 * by small guards instead of Zod: extra Zod validators land in the shared Zod chunk of every route.
 */
const EXPORT_STATUSES = ["queued", "running", "ready", "failed", "expired"] as const;
type DataExport = {
  id: string;
  status: (typeof EXPORT_STATUSES)[number];
  createdAt: string;
  expiresAt?: string;
  sizeBytes?: number;
};
type DeletionRequest = { id: string; requestedAt: string; scheduledFor: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

class InvalidResponse extends Error {
  constructor() {
    super("GDPR_INVALID_RESPONSE");
  }
}

function record(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new InvalidResponse();
  return data as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new InvalidResponse();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !value.includes("T") || Number.isNaN(Date.parse(value)))
    throw new InvalidResponse();
  return value;
}
const dataExport = {
  parse(data: unknown): DataExport {
    const row = record(data);
    const status = EXPORT_STATUSES.find((item) => item === row["status"]);
    const size = row["sizeBytes"];
    if (!status) throw new InvalidResponse();
    if (size !== undefined && (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0))
      throw new InvalidResponse();
    return {
      id: uuid(row["id"]),
      status,
      createdAt: timestamp(row["createdAt"]),
      ...(row["expiresAt"] === undefined ? {} : { expiresAt: timestamp(row["expiresAt"]) }),
      ...(size === undefined ? {} : { sizeBytes: size }),
    };
  },
};
const deletionRequest = {
  parse(data: unknown): DeletionRequest {
    const row = record(data);
    return {
      id: uuid(row["id"]),
      requestedAt: timestamp(row["requestedAt"]),
      scheduledFor: timestamp(row["scheduledFor"]),
    };
  },
};
const POLL_MS = 5000;
const FIELD_IDS = { export: "gdpr-export-code", delete: "gdpr-delete-code" } as const;

class RequestFailed extends Error {
  constructor(readonly status: number) {
    super("GDPR_REQUEST_FAILED");
  }
}

async function call(path: string, method = "GET", headers: Record<string, string> = {}) {
  const response = await fetch(`/api/v1/me/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers,
  });
  if (response.status === 401) {
    await clearPrivateState();
    location.replace("/logowanie?returnTo=%2Fustawienia");
  }
  if (!response.ok) throw new RequestFailed(response.status);
  return response.status === 204 ? null : ((await response.json()) as unknown);
}

export function GdprSettings() {
  const t = useCopy("privacyMessages", defaultT);
  const { formatDateTime } = useFormatters();
  const [current, setCurrent] = useState<DataExport | null>(null);
  const [deletion, setDeletion] = useState<DeletionRequest | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const exportKey = useRef<string | null>(null);

  useEffect(() => {
    void call("deletion-request")
      .then((data) => setDeletion(deletionRequest.parse(data)))
      .catch(() => setDeletion(null));
  }, []);
  useEffect(() => {
    if (!current || (current.status !== "queued" && current.status !== "running")) return;
    const timer = setTimeout(() => {
      void call(`exports/${current.id}`)
        .then((data) => setCurrent(dataExport.parse(data)))
        .catch(() => setMessage(t.error));
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [current, t.error]);

  /** Every right needs a TOTP step-up first; the code field is read from the submitted form. */
  const run = async (form: HTMLFormElement, work: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const code = String(new FormData(form).get("code") ?? "");
      const step = await submitAction("stepUp", { code });
      if (!step.ok) {
        setMessage(t.stepUpInvalid);
        return;
      }
      await work();
      form.reset();
    } catch (error) {
      const status = error instanceof RequestFailed ? error.status : 0;
      setMessage(
        status === 409
          ? t.exportConflict
          : status === 429
            ? t.exportLimit
            : status === 404
              ? t.exportExpired
              : t.error,
      );
    } finally {
      setPending(false);
    }
  };
  const status =
    current?.status === "queued"
      ? t.exportQueued
      : current?.status === "running"
        ? t.exportRunning
        : current?.status === "ready" && current.expiresAt
          ? formatMessage(t.exportReady, { expiresAt: formatDateTime(current.expiresAt) })
          : current?.status === "failed"
            ? t.exportFailed
            : current?.status === "expired"
              ? t.exportExpired
              : "";
  const ready = current?.status === "ready";
  const codeField = (id: string) => (
    <TextField
      id={id}
      name="code"
      label={t.stepUpLabel}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      required
    />
  );

  return (
    <section aria-labelledby="gdpr-heading" className="oi-form">
      <h2 id="gdpr-heading">{t.title}</h2>
      <p>{t.intro}</p>
      <form
        aria-labelledby="gdpr-export-heading"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          void run(form, async () => {
            if (ready && current) {
              const id = current.id;
              // The browser saves the attachment; the archive is gone after this request.
              location.assign(`/api/v1/me/exports/${id}/download`);
              setCurrent({ ...current, status: "expired" });
              return;
            }
            exportKey.current ??= crypto.randomUUID();
            const created = dataExport.parse(
              await call("exports", "POST", { "Idempotency-Key": exportKey.current }),
            );
            exportKey.current = null;
            setCurrent(created);
          });
        }}
      >
        <h3 id="gdpr-export-heading">{t.exportHeading}</h3>
        <p>{t.exportBody}</p>
        {codeField(FIELD_IDS.export)}
        <div className="oi-actions">
          <Button
            type="submit"
            disabled={pending || current?.status === "queued" || current?.status === "running"}
          >
            {ready ? t.exportDownload : t.exportRequest}
          </Button>
        </div>
        <p role="status">{status}</p>
      </form>
      <form
        aria-labelledby="gdpr-delete-heading"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          void run(form, async () => {
            setDeletion(deletionRequest.parse(await call("deletion-request", "POST")));
            setConfirmed(false);
          });
        }}
      >
        <h3 id="gdpr-delete-heading">{t.deleteHeading}</h3>
        <p>{t.deleteBody}</p>
        {deletion ? (
          <>
            <p role="status">
              {formatMessage(t.deleteScheduled, { date: formatDateTime(deletion.scheduledFor) })}
            </p>
            <div className="oi-actions">
              <Button
                disabled={pending}
                onClick={() => {
                  setPending(true);
                  setMessage("");
                  void call("deletion-request", "DELETE")
                    .then(() => {
                      setDeletion(null);
                      setMessage(t.deleteCancelled);
                    })
                    .catch(() => setMessage(t.error))
                    .finally(() => setPending(false));
                }}
              >
                {t.deleteCancel}
              </Button>
            </div>
          </>
        ) : (
          <>
            <label className="oi-checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.currentTarget.checked)}
                required
              />{" "}
              {t.deleteConfirm}
            </label>
            {codeField(FIELD_IDS.delete)}
            <div className="oi-actions">
              <Button type="submit" disabled={pending || !confirmed}>
                {t.deleteRequest}
              </Button>
            </div>
          </>
        )}
      </form>
      <p role="alert">{message}</p>
    </section>
  );
}

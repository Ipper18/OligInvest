"use client";
import { formatMessage } from "@oliginvest/i18n";
import type { AdminMessages } from "@oliginvest/i18n/admin";
import { Button, TextField } from "@oliginvest/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { submitAction } from "../auth/actions";
import { clearPrivateState } from "../auth/logout";
import { type AdminOperation, type AdminOutcome, adminMutation } from "./actions";
import styles from "./admin.module.css";

/**
 * Every administrator change (BL-112, BL-501, BL-509): native validation, then a confirmation
 * dialog naming the effect, then the allow-listed Server Action. `STEP_UP_REQUIRED` turns the same
 * dialog into a TOTP step, after which the call is repeated once. No Zod in this client module:
 * /admin keeps Zod out of its chunks (budgets.json); validation runs in `adminMutation`.
 */
export type AdminRequest = AdminOperation;

async function send(request: AdminRequest): Promise<AdminOutcome> {
  const outcome = await adminMutation(request);
  if (outcome.status === 401) {
    await clearPrivateState();
    location.replace(`/logowanie?returnTo=${encodeURIComponent(location.pathname)}`);
  }
  return outcome;
}

function failure(m: AdminMessages, outcome: AdminOutcome) {
  if (outcome.status === 409) return m.result.conflict;
  if (outcome.status === 422) return m.result.validation;
  if (outcome.status === 404) return m.result.notFound;
  if (outcome.status === 403) return m.result.forbidden;
  return m.result.error;
}

export function AdminAction({
  m,
  label,
  confirm,
  request,
  children,
  onDone,
  className = "",
}: {
  m: AdminMessages;
  label: string;
  /** Confirmation text built from the submitted fields. */
  confirm: (form: FormData) => string;
  request: (form: FormData) => AdminRequest;
  children?: ReactNode;
  onDone?: (data: unknown) => void;
  className?: string;
}) {
  const router = useRouter();
  const titleId = useId();
  const codeId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState<AdminRequest | null>(null);
  const [message, setMessage] = useState("");
  const [stepUp, setStepUp] = useState(false);
  const [busy, setBusy] = useState(false);
  // Page-level result after the dialog closes; dialog-level progress and code errors.
  const [status, setStatus] = useState("");
  const [dialogStatus, setDialogStatus] = useState("");

  const open = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(request(data));
    setMessage(confirm(data));
    setStepUp(false);
    setStatus("");
    setDialogStatus("");
    dialog.current?.showModal();
  };
  // Closing (also by Escape) returns focus to the button that opened the dialog.
  const close = () => dialog.current?.close();
  const run = async (code?: string) => {
    if (!pending || busy) return;
    setBusy(true);
    setDialogStatus(m.result.pending);
    try {
      if (code !== undefined) {
        const step = await submitAction("stepUp", { code });
        if (!step.ok) {
          setDialogStatus(m.stepUp.invalid);
          return;
        }
      }
      const outcome = await send(pending);
      if (outcome.status === 403 && outcome.code === "STEP_UP_REQUIRED" && code === undefined) {
        setStepUp(true);
        setDialogStatus("");
        return;
      }
      setDialogStatus("");
      close();
      if (outcome.status >= 400) {
        setStatus(failure(m, outcome));
        return;
      }
      setStatus(m.result.done);
      onDone?.(outcome.data);
      router.refresh();
    } catch {
      close();
      setStatus(m.result.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form className={`oi-form ${className}`} onSubmit={open}>
        {children}
        <div className="oi-actions">
          <Button ref={trigger} type="submit">
            {label}
          </Button>
        </div>
      </form>
      <p role="status" className="oi-help">
        {status}
      </p>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="oi-dialog"
        onClose={() => trigger.current?.focus()}
      >
        <h2 id={titleId}>{m.confirm.title}</h2>
        <p>{message}</p>
        {stepUp ? (
          <form
            className="oi-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(String(new FormData(event.currentTarget).get("code") ?? ""));
            }}
          >
            <p>{m.stepUp.intro}</p>
            <TextField
              id={codeId}
              name="code"
              label={m.stepUp.label}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
            />
            <p role="status">{dialogStatus}</p>
            <div className="oi-actions">
              <Button type="submit" className="oi-button-primary" disabled={busy}>
                {m.stepUp.submit}
              </Button>
              <Button onClick={close}>{m.confirm.dismiss}</Button>
            </div>
          </form>
        ) : (
          <div className="oi-actions">
            <p role="status">{dialogStatus}</p>
            <Button className="oi-button-primary" disabled={busy} onClick={() => void run()}>
              {m.confirm.accept}
            </Button>
            <Button onClick={close} autoFocus>
              {m.confirm.dismiss}
            </Button>
          </div>
        )}
      </dialog>
    </>
  );
}

const ROLES = ["user", "pro", "admin"] as const;
const toIso = (local: FormDataEntryValue | null) => {
  const value = String(local ?? "");
  return value ? new Date(value).toISOString() : undefined;
};

/** Account actions on /admin/uzytkownicy/[userId]; the API repeats every check server-side. */
export function UserActions({
  m,
  user,
  self,
}: {
  m: AdminMessages;
  user: {
    id: string;
    email: string;
    role: (typeof ROLES)[number];
    banned: boolean;
    deletionRequestedBy?: "user" | "admin" | undefined;
  };
  self: boolean;
}) {
  const id = user.id;
  const ids = {
    role: useId(),
    email: useId(),
    reason: useId(),
    until: useId(),
    reset: useId(),
  };
  const text = (template: string, extra: Record<string, string> = {}) =>
    formatMessage(template, { email: user.email, ...extra });
  return (
    <div className={styles.actions}>
      {self && <p className="oi-help">{m.help.self}</p>}
      <AdminAction
        m={m}
        label={m.actions.role}
        confirm={(form) =>
          text(m.confirm.role, { role: m.roles[form.get("role") as (typeof ROLES)[number]] })
        }
        request={(form) => ({
          op: "updateUser",
          id,
          body: { role: String(form.get("role")) as (typeof ROLES)[number] },
        })}
      >
        <div className="oi-field">
          <label htmlFor={ids.role}>{m.fields.role}</label>
          <select id={ids.role} name="role" className="oi-input" defaultValue={user.role}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {m.roles[role]}
              </option>
            ))}
          </select>
        </div>
      </AdminAction>
      {!self && (
        <AdminAction
          m={m}
          label={m.actions.email}
          confirm={(form) => text(m.confirm.email, { newEmail: String(form.get("email")) })}
          request={(form) => ({
            op: "updateUser",
            id,
            body: { email: String(form.get("email")).trim() },
          })}
        >
          <TextField
            id={ids.email}
            name="email"
            type="email"
            label={m.fields.email}
            autoComplete="off"
            maxLength={254}
            required
          />
        </AdminAction>
      )}
      {!self &&
        (user.banned ? (
          <AdminAction
            m={m}
            label={m.actions.unblock}
            confirm={() => text(m.confirm.unblock)}
            request={() => ({ op: "updateUser", id, body: { banned: false } })}
          />
        ) : (
          <AdminAction
            m={m}
            label={m.actions.block}
            confirm={() => text(m.confirm.block)}
            request={(form) => {
              const until = toIso(form.get("until"));
              return {
                op: "updateUser",
                id,
                body: {
                  banned: true,
                  banReason: String(form.get("reason")).trim(),
                  ...(until ? { banExpires: until } : {}),
                },
              };
            }}
          >
            <TextField
              id={ids.reason}
              name="reason"
              label={m.fields.blockReason}
              minLength={5}
              maxLength={500}
              required
            />
            <TextField
              id={ids.until}
              name="until"
              type="datetime-local"
              label={m.fields.blockUntil}
            />
          </AdminAction>
        ))}
      {!self && (
        <AdminAction
          m={m}
          label={m.actions.reset2fa}
          confirm={() => text(m.confirm.reset2fa)}
          request={(form) => ({
            op: "resetTwoFactor",
            id,
            body: { reason: String(form.get("reason")).trim() },
          })}
        >
          <TextField
            id={ids.reset}
            name="reason"
            label={m.fields.resetReason}
            description={m.help.reset2fa}
            minLength={5}
            maxLength={500}
            required
          />
        </AdminAction>
      )}
      <AdminAction
        m={m}
        label={m.actions.revokeSessions}
        confirm={() => text(m.confirm.revokeSessions)}
        request={() => ({ op: "revokeUserSessions", id })}
      />
      {!self &&
        (user.deletionRequestedBy === "admin" ? (
          <AdminAction
            m={m}
            label={m.actions.cancelDeletion}
            confirm={() => text(m.confirm.cancelDeletion)}
            request={() => ({ op: "cancelDeletion", id })}
          />
        ) : user.deletionRequestedBy === undefined ? (
          <AdminAction
            m={m}
            label={m.actions.delete}
            confirm={() => text(m.confirm.delete)}
            request={() => ({ op: "deleteUser", id })}
          >
            <p className="oi-help">{m.help.delete}</p>
          </AdminAction>
        ) : null)}
    </div>
  );
}

/** One-row action (end a session, revoke an invitation). */
export function RowAction({
  m,
  label,
  confirmText,
  request,
}: {
  m: AdminMessages;
  label: string;
  confirmText: string;
  request: AdminRequest;
}) {
  return <AdminAction m={m} label={label} confirm={() => confirmText} request={() => request} />;
}

/** Issues an invitation; the link is shown once (FR-07.01). */
export function InvitationForm({ m }: { m: AdminMessages }) {
  const ids = { email: useId(), role: useId(), hours: useId(), send: useId() };
  const key = useRef<string | null>(null);
  const [link, setLink] = useState("");
  return (
    <>
      <AdminAction
        m={m}
        label={m.actions.createInvitation}
        confirm={(form) =>
          formatMessage(m.confirm.createInvitation, {
            email: String(form.get("email")),
            role: m.roles[form.get("role") as (typeof ROLES)[number]],
          })
        }
        request={(form) => {
          key.current ??= crypto.randomUUID();
          return {
            op: "createInvitation",
            key: key.current,
            body: {
              email: String(form.get("email")).trim(),
              role: String(form.get("role")) as (typeof ROLES)[number],
              expiresInHours: Number(form.get("hours")),
              sendEmail: form.get("send") === "on",
            },
          };
        }}
        onDone={(data) => {
          key.current = null;
          const url = (data as { inviteUrl?: unknown } | undefined)?.inviteUrl;
          // Shown as text to copy, never as a link; the API builds it from PUBLIC_BASE_URL.
          setLink(typeof url === "string" && url.startsWith("https://") ? url : "");
        }}
      >
        <TextField
          id={ids.email}
          name="email"
          type="email"
          label={m.fields.inviteEmail}
          autoComplete="off"
          maxLength={254}
          required
        />
        <div className="oi-field">
          <label htmlFor={ids.role}>{m.fields.inviteRole}</label>
          <select id={ids.role} name="role" className="oi-input" defaultValue="user">
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {m.roles[role]}
              </option>
            ))}
          </select>
        </div>
        <TextField
          id={ids.hours}
          name="hours"
          type="number"
          label={m.fields.inviteHours}
          min={1}
          max={168}
          defaultValue={72}
          required
        />
        <label className="oi-checkbox" htmlFor={ids.send}>
          <input id={ids.send} name="send" type="checkbox" defaultChecked /> {m.fields.inviteSend}
        </label>
      </AdminAction>
      {link && (
        <div role="status">
          <p>{m.result.inviteCreated}</p>
          <p>
            <code className={styles.link}>{link}</code>
          </p>
        </div>
      )}
    </>
  );
}

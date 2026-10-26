"use client";
import { appMessages, errorMessages, formatMessage } from "@oliginvest/i18n";
import { Button, TextField } from "@oliginvest/ui";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { ActionName } from "../api/validation";
import { type ActionResult, submitAction } from "./actions";
import { clearPrivateState } from "./logout";
import { safeReturnTo } from "./navigation";

const t = appMessages;
export type FormKind =
  | "signIn"
  | "totp"
  | "register"
  | "enable"
  | "requestReset"
  | "reset"
  | "accept";
export const formTitles = {
  signIn: t.signIn,
  totp: t.code,
  register: t.register,
  enable: t.enrollment,
  requestReset: t.reset,
  reset: t.newPassword,
  accept: t.termsTitle,
};
export function AuthForm({
  kind,
  enrolled = false,
  termsVersion = "2026-09",
  privacyVersion = "2026-09",
}: {
  kind: FormKind;
  enrolled?: boolean;
  termsVersion?: string;
  privacyVersion?: string;
}) {
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState<Extract<ActionResult, { ok: false }> | null>(null),
    [message, setMessage] = useState("");
  const [token, setToken] = useState(""),
    [validToken, setValidToken] = useState(false),
    [backup, setBackup] = useState(false),
    [enabled, setEnabled] = useState<{ qr: string; secret: string; codes: string[] } | null>(null),
    [verified, setVerified] = useState(false);
  const summary = useRef<HTMLDivElement>(null),
    fragmentRead = useRef(false);
  const search = useSearchParams();
  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (error) summary.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!["register", "reset"].includes(kind) || fragmentRead.current) return;
    fragmentRead.current = true;
    const value = new URLSearchParams(location.hash.slice(1)).get("t") ?? "";
    history.replaceState(null, "", location.pathname + location.search);
    setToken(value);
    if (kind === "register") {
      if (!value) {
        setMessage(t.invalidInvitation);
        return;
      }
      void submitAction("preview", { token: value }).then((result) => {
        setValidToken(result.ok);
        if (!result.ok) setMessage(t.invalidInvitation);
      });
    } else {
      setValidToken(value.length > 0);
      if (!value) setMessage(t.invalidReset);
    }
    return () => {};
  }, [kind]);
  const destination = safeReturnTo(search.get("returnTo"));
  const returnTo = () => location.assign(destination);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage("");
    const form = event.currentTarget;
    const fields = new FormData(form);
    const get = (key: string) => String(fields.get(key) ?? "");
    let name: ActionName = kind;
    let input: Record<string, unknown> = {};
    if (kind === "signIn")
      input = {
        email: get("email"),
        password: get("password"),
        rememberMe: fields.has("remember"),
      };
    if (kind === "totp" || (kind === "enable" && enabled)) {
      name = backup ? "backup" : "totp";
      input = { code: get("code").trim() };
    } else if (kind === "enable") input = { password: get("password") };
    if (kind === "register")
      input = {
        name: get("name"),
        email: get("email"),
        password: get("password"),
        invitationToken: token,
        acceptTerms: fields.has("terms"),
        termsVersion,
        privacyNoticeVersion: privacyVersion,
        diagnosticsConsent: fields.has("diagnostics"),
      };
    if (kind === "requestReset") input = { email: get("email"), redirectTo: "/reset-hasla/nowe" };
    if (kind === "reset") input = { token, newPassword: get("password") };
    if (kind === "accept") input = { termsVersion, privacyNoticeVersion: privacyVersion };
    const result = await submitAction(name, input);
    setBusy(false);
    if (!result.ok) {
      setError(result);
      return;
    }
    if (name === "enable") {
      const uri = new URL(String(result.data.totpURI));
      setEnabled({
        qr: String(result.data.qr),
        secret: uri.searchParams.get("secret") ?? "",
        codes: result.data.backupCodes as string[],
      });
      form.reset();
    } else if (kind === "enable") {
      setEnabled((previous) =>
        previous
          ? {
              qr: "",
              secret: "",
              codes: (result.data.backupCodes as string[] | undefined) ?? previous.codes,
            }
          : null,
      );
      setVerified(true);
      form.reset();
    } else if (kind === "requestReset") setMessage(t.resetSent);
    else if (kind === "reset") {
      setToken("");
      setValidToken(false);
      setMessage(t.passwordSaved);
      form.reset();
    } else if (kind === "register") {
      setToken("");
      location.assign("/konfiguracja-2fa");
    } else if (kind === "signIn" && result.data.twoFactorRedirect)
      location.assign(`/logowanie/2fa?returnTo=${encodeURIComponent(destination)}`);
    else returnTo();
  }
  useEffect(() => {
    if (enrolled && !enabled) location.replace(destination);
  }, [enrolled, enabled, destination]);
  const fieldError = (key: string) =>
    error?.errors.some((e) => e.path === key || e.path === `body.${key}`) ? t.required : undefined;
  const fieldErrors = {
    name: fieldError("name"),
    email: fieldError("email"),
    password: fieldError("password"),
    code: fieldError("code"),
  };
  const err = error
    ? (errorMessages[error.code as keyof typeof errorMessages] ?? errorMessages.INTERNAL)
    : null;
  const credentialFields = kind === "signIn" || kind === "register" || kind === "requestReset";
  const passwordField =
    kind === "signIn" || kind === "register" || kind === "reset" || (kind === "enable" && !enabled);
  return (
    <section className="oi-auth">
      <h1>{formTitles[kind]}</h1>
      {kind === "register" && <p>{t.invitationHint}</p>}
      {kind === "totp" && <p>{t.twoFactorHint}</p>}
      {kind === "enable" && <p>{t.enrollmentHint}</p>}
      {kind === "accept" && <p>{t.termsHint}</p>}
      {error && err && (
        <div ref={summary} tabIndex={-1} role="alert" className="oi-error-summary">
          <h2>{err.title}</h2>
          <p>
            {formatMessage(err.description, { seconds: error.seconds, requestId: error.requestId })}
          </p>
          {error.errors.length > 0 && (
            <ul>
              {error.errors.map((e) => (
                <li key={e.path}>
                  <a href={`#${e.path.replace(/^body\./u, "")}`}>{t.required}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p role="status">{message}</p>
      {enabled && (
        <div className="oi-enrollment">
          {!verified && (
            <>
              <img width={256} height={256} src={enabled.qr} alt={t.qr} />
              <p>{t.secret}</p>
              <code className="oi-secret">{enabled.secret}</code>
            </>
          )}
          {verified && (
            <>
              <h2>{t.backupTitle}</h2>
              <p>{t.backupHint}</p>
              <ol className="oi-backup-codes">
                {enabled.codes.map((code) => (
                  <li key={code}>
                    <code>{code}</code>
                  </li>
                ))}
              </ol>
              <div className="oi-actions">
                <Button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(enabled.codes.join("\n"));
                      setMessage(t.copied);
                    } catch {
                      setMessage(t.backupHint);
                    }
                  }}
                >
                  {t.copy}
                </Button>
                <Button
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([enabled.codes.join("\n")], { type: "text/plain;charset=utf-8" }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "oliginvest-backup-codes.txt";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  {t.download}
                </Button>
                <Button
                  onClick={() => {
                    setEnabled(null);
                    returnTo();
                  }}
                >
                  {t.savedCodes}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {!verified && (
        <form method="post" onSubmit={submit} aria-busy={busy} className="oi-form">
          {kind === "register" && (
            <TextField
              id="name"
              name="name"
              label={t.name}
              autoComplete="name"
              required
              maxLength={80}
              error={fieldErrors.name}
            />
          )}
          {credentialFields && (
            <TextField
              id="email"
              name="email"
              label={t.email}
              type="email"
              autoComplete={kind === "signIn" ? "username" : "email"}
              required
              error={fieldErrors.email}
            />
          )}
          {passwordField && (
            <TextField
              id="password"
              name="password"
              label={kind === "reset" ? t.newPassword : t.password}
              type="password"
              autoComplete={
                kind === "register" || kind === "reset" ? "new-password" : "current-password"
              }
              required
              minLength={kind === "register" || kind === "reset" ? 12 : 1}
              maxLength={128}
              description={kind === "register" || kind === "reset" ? t.passwordHint : undefined}
              error={fieldErrors.password}
            />
          )}
          {kind === "signIn" && (
            <label className="oi-checkbox">
              <input type="checkbox" name="remember" defaultChecked />
              {t.remember}
            </label>
          )}
          {(kind === "totp" || (kind === "enable" && enabled)) && (
            <>
              <TextField
                id="code"
                name="code"
                label={backup ? t.backupCode : t.code}
                autoComplete="one-time-code"
                inputMode={backup ? "text" : "numeric"}
                required
                pattern={backup ? undefined : "[0-9]{6}"}
                minLength={backup ? 8 : 6}
                maxLength={backup ? 16 : 6}
                error={fieldErrors.code}
              />
              {kind === "totp" && (
                <Button
                  onClick={() => {
                    setBackup(!backup);
                    setError(null);
                  }}
                >
                  {backup ? t.useTotp : t.useBackup}
                </Button>
              )}
            </>
          )}
          {(kind === "register" || kind === "accept") && (
            <>
              <a href="/regulamin" target="_blank" rel="noopener noreferrer">
                {t.terms}
              </a>
              <label className="oi-checkbox">
                <input id="terms" type="checkbox" name="terms" required />
                {t.acceptTerms}
              </label>
              <a href="/prywatnosc" target="_blank" rel="noopener noreferrer">
                {t.privacy}
              </a>
              <label className="oi-checkbox">
                <input id="privacy" type="checkbox" name="privacy" required />
                {t.acknowledgePrivacy}
              </label>
              {kind === "register" && (
                <label className="oi-checkbox">
                  <input type="checkbox" name="diagnostics" />
                  {t.diagnostics}
                </label>
              )}
            </>
          )}
          <Button
            type="submit"
            disabled={!ready || busy || (["register", "reset"].includes(kind) && !validToken)}
          >
            {busy
              ? t.pending
              : kind === "totp" || (kind === "enable" && enabled)
                ? t.verify
                : kind === "requestReset"
                  ? t.sendReset
                  : kind === "accept"
                    ? t.accept
                    : formTitles[kind]}
          </Button>
        </form>
      )}
      {kind === "signIn" ? (
        <a href="/reset-hasla">{t.forgot}</a>
      ) : (
        <a href="/logowanie">{t.signIn}</a>
      )}
      {(kind === "enable" || kind === "accept" || kind === "totp") && (
        <Button
          onClick={async () => {
            setEnabled(null);
            await clearPrivateState();
            await submitAction("signOut", {});
            location.replace("/logowanie");
          }}
        >
          {t.signOut}
        </Button>
      )}
    </section>
  );
}

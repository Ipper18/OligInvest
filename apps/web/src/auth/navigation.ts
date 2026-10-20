export function safeReturnTo(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    return "/";
  try {
    const url = new URL(value, "https://local.invalid");
    if (
      url.origin !== "https://local.invalid" ||
      /^\/(api|logowanie|rejestracja|reset-hasla|konfiguracja-2fa|akceptacja-regulaminu)(\/|$)/u.test(
        url.pathname,
      )
    )
      return "/";
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}
export function gatePath(
  me: {
    mfa: { enrolled: boolean; sessionVerifiedAt?: string | undefined };
    legal: { termsAcceptanceRequired: boolean };
  } | null,
): string | null {
  if (!me) return "/logowanie";
  if (!me.mfa.enrolled) return "/konfiguracja-2fa";
  if (!me.mfa.sessionVerifiedAt) return "/logowanie/2fa";
  if (me.legal.termsAcceptanceRequired) return "/akceptacja-regulaminu";
  return null;
}

export function authDestination(gate: ReturnType<typeof gatePath>, returnTo: unknown): string {
  const destination = safeReturnTo(returnTo);
  return gate ? `${gate}?${new URLSearchParams({ returnTo: destination })}` : destination;
}

import { safeReturnTo } from "@oliginvest/contracts/navigation";

export { safeReturnTo };
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

/**
 * Language of public pages (private pages read the session preferences). Only the server writes it,
 * always HttpOnly (ZAP 10010): `proxy.ts` syncs it from `/me`, `relay.ts` after saved preferences.
 */
export const LOCALE_COOKIE = "oi-locale";

export function localeCookieOptions(development: boolean) {
  return { httpOnly: true, secure: !development, sameSite: "lax", path: "/" } as const;
}

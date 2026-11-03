/** Accept only canonical relative application paths, never actions or external URLs. */
export function safeReturnTo(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return "/";
  const target = value.split("#", 1)[0]!;
  const path = target.split("?", 1)[0]!;
  if (
    path.includes("%") ||
    path.split("/").some((part) => part === "." || part === "..") ||
    /^\/(api|auth|internal|_next|logowanie|rejestracja|reset-hasla|konfiguracja-2fa|akceptacja-regulaminu)(\/|$)/u.test(
      path,
    )
  )
    return "/";
  return target;
}

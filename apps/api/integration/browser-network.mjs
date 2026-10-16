// Test preload: a deterministic HIBP boundary, with all other external HTTP denied.
// Real registration, Argon2, invitations, MFA, sessions and RLS remain unchanged.
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "api.pwnedpasswords.com" && /^\/range\/[A-F0-9]{5}$/i.test(url.pathname))
    return new Response("00000000000000000000000000000000000:0\r\n");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("E2E_EXTERNAL_HTTP_FORBIDDEN");
  return original(input, init);
};

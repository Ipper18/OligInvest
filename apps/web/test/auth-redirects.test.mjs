import { beforeEach, expect, test, vi } from "vitest";

const context = vi.hoisted(() => ({ me: null, challenge: false }));
vi.mock("../src/auth/session", () => ({ getMe: async () => context.me }));
vi.mock("../src/auth/form", () => ({ AuthForm: () => null }));
vi.mock("../src/api/server", () => ({ getApiClient: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ has: () => context.challenge }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path) => {
    throw new Error(`redirect:${path}`);
  },
}));

const { default: signIn } = await import("../src/app/(auth)/logowanie/page.tsx");
const { default: totp } = await import("../src/app/(auth)/logowanie/2fa/page.tsx");
const { default: enrollment } = await import("../src/app/(auth)/konfiguracja-2fa/page.tsx");
const { default: legal } = await import("../src/app/(auth)/akceptacja-regulaminu/page.tsx");
const props = (returnTo) => ({ searchParams: Promise.resolve({ returnTo }) });

beforeEach(() => {
  context.me = {
    mfa: { enrolled: true, sessionVerifiedAt: "2026-10-19T12:00:00Z" },
    legal: { termsAcceptanceRequired: false },
  };
  context.challenge = false;
});

test("completed auth pages retain the destination when rendered with a rotated session", async () => {
  for (const page of [signIn, totp, legal])
    await expect(page(props("/ustawienia?tab=security"))).rejects.toThrow(
      "redirect:/ustawienia?tab=security",
    );
});

test("server gate transitions carry the original destination", async () => {
  context.me.legal.termsAcceptanceRequired = true;
  for (const page of [signIn, totp, enrollment])
    await expect(page(props("/ustawienia"))).rejects.toThrow(
      "redirect:/akceptacja-regulaminu?returnTo=%2Fustawienia",
    );
  context.me.mfa.sessionVerifiedAt = undefined;
  await expect(signIn(props("/ustawienia"))).rejects.toThrow(
    "redirect:/logowanie/2fa?returnTo=%2Fustawienia",
  );
  context.me.mfa.enrolled = false;
  await expect(totp(props("/ustawienia"))).rejects.toThrow(
    "redirect:/konfiguracja-2fa?returnTo=%2Fustawienia",
  );
  context.me = null;
  for (const page of [totp, enrollment, legal])
    await expect(page(props("/ustawienia"))).rejects.toThrow(
      "redirect:/logowanie?returnTo=%2Fustawienia",
    );
});

test("server redirects apply the existing returnTo validation", async () => {
  for (const returnTo of [
    undefined,
    ["/ustawienia", "//bad.test"],
    "https://bad.test",
    "//bad.test",
    "/\\bad.test",
    "/\nbad.test",
    "/logowanie/2fa",
    "/api/auth/sign-out",
  ]) {
    await expect(totp(props(returnTo))).rejects.toThrow(/^redirect:\/$/);
    context.me.legal.termsAcceptanceRequired = true;
    await expect(totp(props(returnTo))).rejects.toThrow(
      "redirect:/akceptacja-regulaminu?returnTo=%2F",
    );
    context.me.legal.termsAcceptanceRequired = false;
  }
});

test("MFA challenge and one-time enrollment codes remain on their forms", async () => {
  expect((await enrollment(props("/ustawienia"))).props).toMatchObject({
    kind: "enable",
    enrolled: true,
  });
  context.me = null;
  context.challenge = true;
  expect((await totp(props("/ustawienia"))).props.kind).toBe("totp");
});

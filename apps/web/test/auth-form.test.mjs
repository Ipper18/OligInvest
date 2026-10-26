import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("../src/auth/actions", () => ({ submitAction: vi.fn() }));
vi.mock("../src/auth/logout", () => ({ clearPrivateState: vi.fn() }));
const { AuthForm } = await import("../src/auth/form");

test("server-rendered auth forms never submit credentials by GET before hydration", () => {
  for (const kind of ["signIn", "totp", "register", "enable", "requestReset", "reset", "accept"]) {
    const html = renderToStaticMarkup(createElement(AuthForm, { kind }));
    expect(html).toMatch(/<form[^>]*method="post"/u);
    const submit = html.match(/<button\b[^>]*>/gu)?.find((tag) => tag.includes('type="submit"'));
    expect(submit).toContain('disabled=""');
  }
});

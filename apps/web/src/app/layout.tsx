import { messages } from "@oliginvest/i18n";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import inline from "../appearance/inline-css.json";
import { getTestPreferences } from "../appearance/preferences";
import { getMe } from "../auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: messages.app.brand,
  description: messages.bootstrap.description,
};

async function appearance() {
  const pathname = (await headers()).get("x-oi-pathname") ?? "";
  if (pathname.startsWith("/ui-preview")) return getTestPreferences();
  if (
    pathname === "/" ||
    /^\/(portfel|rynek|analizy|alerty|nauka|ustawienia|admin)(\/|$)/u.test(pathname)
  ) {
    const me = await getMe();
    if (me?.mfa.enrolled && me.mfa.sessionVerifiedAt && !me.legal.termsAcceptanceRequired)
      return {
        theme: me.preferences.theme,
        palette: me.preferences.plPalette === "colorblind" ? "colorblind" : "standard",
      };
  }
  return { theme: "dark", palette: "standard" };
}

export async function generateViewport(): Promise<Viewport> {
  const { theme } = await appearance();
  const dark = "#0B0D0F";
  const light = "#FAFAF7";
  return {
    themeColor: [
      { media: "(prefers-color-scheme: dark)", color: theme === "light" ? light : dark },
      { media: "(prefers-color-scheme: light)", color: theme === "dark" ? dark : light },
    ],
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { theme, palette } = await appearance();
  return (
    <html lang="pl" data-theme={theme} data-palette={palette}>
      <head>
        <style nonce={(await headers()).get("x-nonce") ?? undefined}>{inline.css}</style>
      </head>
      <body className="min-h-dvh bg-bg font-sans text-ink">{children}</body>
    </html>
  );
}

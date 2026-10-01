import { messages } from "@oliginvest/i18n";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { getTestPreferences } from "../appearance/preferences";
import "./globals.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: messages.bootstrap.title,
  description: messages.bootstrap.description,
};

export async function generateViewport(): Promise<Viewport> {
  const { theme } = await getTestPreferences();
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
  const { theme, palette } = await getTestPreferences();
  return (
    <html lang="pl" data-theme={theme} data-palette={palette}>
      <body className="min-h-dvh bg-bg font-sans text-ink">{children}</body>
    </html>
  );
}

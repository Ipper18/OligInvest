import { messages } from "@oliginvest/i18n";
import type * as React from "react";
import { getHealthStatus } from "../api/server";
import { getTestPreferences } from "../appearance/preferences";
import { ThemeControls } from "../appearance/theme-controls";

export default async function TestPage(): Promise<React.JSX.Element> {
  const status = await getHealthStatus();
  const { theme, palette } = await getTestPreferences();
  return (
    <main className="mx-auto max-w-prose px-4 py-8">
      <h1 className="font-serif text-2xl font-semibold">{messages.bootstrap.title}</h1>
      <p className="mt-3 text-sm text-muted">{messages.bootstrap.description}</p>
      <p className="num my-5 text-sm">{messages.bootstrap.apiStatus[status]}</p>
      <ThemeControls initialTheme={theme} initialPalette={palette} />
    </main>
  );
}

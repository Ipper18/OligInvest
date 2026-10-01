"use client";

import { messages } from "@oliginvest/i18n";
import { useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";
type Palette = "standard" | "colorblind";

function savePreference(key: "theme" | "palette", value: Theme | Palette) {
  document.documentElement.dataset[key] = value;
  // biome-ignore lint/suspicious/noDocumentCookie: Non-sensitive test preference; document.cookie also works in older Safari.
  document.cookie = `oi-test-${key}=${value}; Path=/; SameSite=Lax; Max-Age=31536000${location.protocol === "https:" ? "; Secure" : ""}`;
}

export function ThemeControls({
  initialTheme,
  initialPalette,
}: {
  initialTheme: Theme;
  initialPalette: Palette;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const [palette, setPalette] = useState(initialPalette);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const updateColor = () => {
      const color = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-bg")
        .trim();
      for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
        meta.content = color;
    };
    updateColor();
    media.addEventListener("change", updateColor);
    return () => media.removeEventListener("change", updateColor);
  }, [theme]);

  return (
    <section className="border-t border-hairline py-5" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading" className="font-serif text-xl font-semibold">
        {messages.bootstrap.appearance}
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <label className="label" htmlFor="test-theme">
            {messages.bootstrap.themeLabel}
          </label>
          <select
            id="test-theme"
            value={theme}
            onChange={(event) => {
              const value = event.target.value;
              if (value !== "dark" && value !== "light" && value !== "system") return;
              savePreference("theme", value);
              setTheme(value);
            }}
          >
            {(["dark", "light", "system"] as const).map((value) => (
              <option key={value} value={value}>
                {messages.bootstrap.themes[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <label className="label" htmlFor="test-palette">
            {messages.bootstrap.paletteLabel}
          </label>
          <select
            id="test-palette"
            value={palette}
            onChange={(event) => {
              const value = event.target.value;
              if (value !== "standard" && value !== "colorblind") return;
              savePreference("palette", value);
              setPalette(value);
            }}
          >
            {(["standard", "colorblind"] as const).map((value) => (
              <option key={value} value={value}>
                {messages.bootstrap.palettes[value]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted">{messages.bootstrap.preferenceNotice}</p>
      <p className="num mt-3 text-sm">
        <span className="text-gain">{messages.bootstrap.gainSample}</span>
        {" · "}
        <span className="text-loss">{messages.bootstrap.lossSample}</span>
      </p>
    </section>
  );
}

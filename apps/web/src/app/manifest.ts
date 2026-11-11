import { pwaMessages as defaultT } from "@oliginvest/i18n";
import type { MetadataRoute } from "next";
import { getRequestLocalization } from "../appearance/localization";
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const localization = await getRequestLocalization();
  const t = (localization.copies.pwaMessages as typeof defaultT | undefined) ?? defaultT;
  return {
    id: "/",
    name: "OligInvest",
    short_name: "OligInvest",
    description: t.description,
    lang: localization.locale === "en-US" ? "en" : "pl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0B0D0F",
    theme_color: "#0B0D0F",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: t.shortcutAdd, url: "/portfel/operacje/nowa" },
      { name: t.shortcutToday, url: "/?sekcja=wynik-dnia" },
      { name: t.shortcutAlerts, url: "/alerty" },
      { name: t.shortcutSearch, url: "/rynek" },
    ],
  };
}

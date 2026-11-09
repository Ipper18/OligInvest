import page from "../../pwa/offline-page.json";
export function GET(request: Request) {
  const english = new URL(request.url).searchParams.get("locale") === "en-US";
  return new Response(english ? page.english : page.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Language": english ? "en" : "pl",
    },
  });
}

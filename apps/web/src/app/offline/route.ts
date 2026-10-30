import page from "../../pwa/offline-page.json";
export function GET() {
  return new Response(page.html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

import { legalCopy } from "@oliginvest/i18n/legal";
import { legalText } from "../../../legal/configuration";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ document: string }> },
) {
  const { document } = await params;
  if (document !== "terms" && document !== "privacy" && document !== "sources")
    return new Response(null, { status: 404 });
  return new Response(legalText(legalCopy[document].source), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="oliginvest-${document}-2026-09.txt"`,
      "Cache-Control": "no-store",
    },
  });
}

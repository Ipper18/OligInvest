import { legalCopy as defaultLegalCopy } from "@oliginvest/i18n/legal";
import { getRequestLocalization } from "../../../appearance/localization";
import { legalText } from "../../../legal/configuration";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ document: string }> },
) {
  const { document } = await params;
  const legalCopy =
    ((await getRequestLocalization()).copies.legalCopy as typeof defaultLegalCopy | undefined) ??
    defaultLegalCopy;
  if (document !== "terms" && document !== "privacy" && document !== "sources")
    return new Response(null, { status: 404 });
  return new Response(legalText(legalCopy[document].source, legalCopy.labels.missing), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="oliginvest-${document}-2026-09.txt"`,
      "Cache-Control": "no-store",
    },
  });
}

import { portfolioMessages as defaultM } from "@oliginvest/i18n";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { notFound } from "next/navigation";
import { requireMe } from "../../../../../auth/session";
import { ImportPreview } from "../../../../../portfolio/import-screens";
import type { SearchParams } from "../../../../../portfolio/page";
import { PortfolioHeader } from "../../../../../portfolio/page-header";
import { DomainError, fetchResource, readArgs } from "../../../../../portfolio/resources";
export const metadata = { title: "Podgląd importu — OligInvest" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ importId: string }>;
  searchParams: SearchParams;
}) {
  const m =
    ((await getLocalization()).copies["portfolioMessages"] as typeof defaultM | undefined) ??
    defaultM;

  const me = await requireMe();
  const { importId } = await params;
  const parsed = readArgs.safeParse({ ...(await searchParams), id: importId });
  if (!parsed.success) notFound();
  const args = { ...parsed.data, status: parsed.data.status ?? "unresolved" };
  try {
    const batch = await fetchResource("import", { id: importId });
    if (batch.source === "mbank" && me.features["module.portfolio.import.mbank"] !== true)
      notFound();
    return (
      <section>
        <PortfolioHeader title={m.preview} current="imports" />
        <ImportPreview
          userId={me.id}
          args={args}
          initial={batch}
          initialRows={await fetchResource("rows", args)}
        />
      </section>
    );
  } catch (e) {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

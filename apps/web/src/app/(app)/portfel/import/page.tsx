import { portfolioMessages as defaultM } from "@oliginvest/i18n";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { requireMe } from "../../../../auth/session";
import { ImportUpload } from "../../../../portfolio/import-screens";
import { PortfolioHeader } from "../../../../portfolio/page-header";
import { fetchResource } from "../../../../portfolio/resources";
export const metadata = { title: "Import — OligInvest" };
export default async function Page() {
  const m =
    ((await getLocalization()).copies["portfolioMessages"] as typeof defaultM | undefined) ??
    defaultM;

  const me = await requireMe();
  return (
    <section>
      <PortfolioHeader title={m.imports} current="imports" />
      <ImportUpload
        userId={me.id}
        mbank={me.features["module.portfolio.import.mbank"] === true}
        accounts={(await fetchResource("accounts")).data}
        initial={await fetchResource("imports")}
      />
    </section>
  );
}

import { portfolioMessages as m } from "@oliginvest/i18n";
import { requireMe } from "../../../../auth/session";
import { ImportUpload } from "../../../../portfolio/import-screens";
import { PortfolioNav } from "../../../../portfolio/presentation";
import { fetchResource } from "../../../../portfolio/resources";
export const metadata = { title: "Import — OligInvest" };
export default async function Page() {
  const me = await requireMe();
  return (
    <section>
      <h1>{m.imports}</h1>
      <PortfolioNav />
      <ImportUpload
        userId={me.id}
        mbank={me.features["module.portfolio.import.mbank"] === true}
        accounts={(await fetchResource("accounts")).data}
        initial={await fetchResource("imports")}
      />
    </section>
  );
}

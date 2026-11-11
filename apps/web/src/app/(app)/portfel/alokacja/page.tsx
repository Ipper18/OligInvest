import { allocationMessages as defaultM } from "@oliginvest/i18n/allocation";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { requireMe } from "../../../../auth/session";
import { AllocationView, ClassificationFields } from "../../../../portfolio/allocation-view";
import { PortfolioHeader } from "../../../../portfolio/page-header";

export default async function Page() {
  const m =
    ((await getLocalization()).copies["allocationMessages"] as typeof defaultM | undefined) ??
    defaultM;

  await requireMe();
  return (
    <section>
      <PortfolioHeader title={m.title} current="allocation" />
      <label htmlFor="allocation-by">{m.by}</label>
      <select id="allocation-by" disabled defaultValue="asset_class">
        {Object.entries(m.groups).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <AllocationView data={null} />
      <ClassificationFields disabled />
    </section>
  );
}

import { allocationMessages as m } from "@oliginvest/i18n/allocation";
import { requireMe } from "../../../../auth/session";
import { AllocationView, ClassificationFields } from "../../../../portfolio/allocation-view";
import { PortfolioNav } from "../../../../portfolio/presentation";

export default async function Page() {
  await requireMe();
  return (
    <section>
      <h1>{m.title}</h1>
      <PortfolioNav />
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

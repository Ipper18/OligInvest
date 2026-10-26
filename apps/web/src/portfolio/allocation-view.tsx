import { allocationMessages as m } from "@oliginvest/i18n/allocation";
import { AssumptionsBlock, Disclaimer } from "@oliginvest/ui";
import { DataTable } from "@oliginvest/ui/table";
import type { components, operations } from "../api/schema";
import { Explainer } from "../education/explainer";
import { Amount, Freshness, ratio } from "./presentation";

export type Allocation = components["schemas"]["Allocation"];
export type InstrumentOverride = components["schemas"]["InstrumentOverride"];
export type AllocationBy = NonNullable<operations["getAllocation"]["parameters"]["query"]>["by"];

// Presentation only: the portfolio session will provide data and mutation handlers.
export function AllocationView({ data }: { data: Allocation | null }) {
  return (
    <>
      <p>{m.basis}</p>
      <Explainer termKey="alokacja" term={m.title} />
      <AssumptionsBlock summary={m.title}>
        <p>{m.basis}</p>
      </AssumptionsBlock>
      {data ? (
        <>
          <dl>
            <dt>{m.total}</dt>
            <dd>
              <Amount value={data.total} />
            </dd>
          </dl>
          <Freshness meta={data.meta} />
          <DataTable
            caption={m.title}
            headings={[m.group, m.value, m.weight, m.classification]}
            rows={data.slices.map((slice) => ({
              id: slice.key,
              cells: [
                slice.label,
                <Amount key="value" value={slice.value} />,
                ratio(slice.weight),
                slice.overridden ? m.overridden : m.catalog,
              ],
            }))}
          />
        </>
      ) : (
        <p role="status">{m.pending}</p>
      )}
      <Disclaimer disclaimerKey="education" version="2026-09" />
    </>
  );
}

export function ClassificationFields({
  value,
  disabled = false,
}: {
  value?: InstrumentOverride;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend>{m.classification}</legend>
      <label htmlFor="classification-asset">{m.groups.asset_class}</label>
      <select id="classification-asset" name="assetClass" defaultValue={value?.assetClass ?? ""}>
        <option value="">{m.unchanged}</option>
        {Object.entries(m.classes).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <label>
        {m.groups.sector}
        <input name="sectorCode" maxLength={40} defaultValue={value?.sectorCode} />
      </label>
      <label>
        {m.groups.country}
        <input name="country" pattern="[A-Z]{2}" maxLength={2} defaultValue={value?.country} />
      </label>
      <label>
        {m.note}
        <input name="note" maxLength={280} defaultValue={value?.note} />
      </label>
      <p>{m.currencyHelp}</p>
    </fieldset>
  );
}

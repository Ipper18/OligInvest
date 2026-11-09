import { Explainer } from "./explainer";
import { localizedHeadingKeys } from "./metric-keys";
export function metricHeadings(
  headings: string[],
  copy: typeof import("@oliginvest/i18n").portfolioMessages,
) {
  const headingKeys = localizedHeadingKeys(copy);
  return Object.fromEntries(
    headings
      .filter((heading) => headingKeys[heading])
      .map((heading) => [
        heading,
        <span key={heading}>
          {heading}
          <Explainer termKey={headingKeys[heading] ?? "wartosc"} term={heading} />
        </span>,
      ]),
  );
}

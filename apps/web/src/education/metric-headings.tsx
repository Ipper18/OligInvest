import { Explainer } from "./explainer";
import { headingKeys } from "./metric-keys";
export function metricHeadings(headings: string[]) {
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

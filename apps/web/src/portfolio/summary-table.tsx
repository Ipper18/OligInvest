import { portfolioMessages as m } from "@oliginvest/i18n";
import type { DataTable } from "@oliginvest/ui/table";
import type { ComponentProps } from "react";
// HTML fallback before the live screen hydrates; the client owns virtualization.
export function SummaryTable({ caption, headings, rows }: ComponentProps<typeof DataTable>) {
  if (!rows.length) return <p>{m.empty}</p>;
  return (
    <section
      className="oi-table-scroll"
      aria-label={caption}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable table must be reachable from the keyboard.
      tabIndex={0}
    >
      <table className="oi-data-table" aria-rowcount={rows.length + 1}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading} scope="col">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((row, index) => (
            <tr key={row.id} aria-rowindex={index + 2}>
              {row.cells.map((cell, column) => (
                <td key={headings[column]}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

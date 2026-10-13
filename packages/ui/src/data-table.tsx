"use client";
import { portfolioMessages as m } from "@oliginvest/i18n";
import { type ComponentType, type ReactNode, useEffect, useState } from "react";
export type TableProps = {
  caption: string;
  headings: string[];
  rows: { id: string; cells: ReactNode[] }[];
};
export function DataTable(props: TableProps) {
  const [Virtual, setVirtual] = useState<ComponentType<TableProps> | null>(null);
  useEffect(() => {
    if (props.rows.length > 100)
      void import("./virtual-table.js").then((module) => setVirtual(() => module.VirtualTable));
  }, [props.rows.length]);
  if (!props.rows.length) return <p>{m.empty}</p>;
  if (Virtual && props.rows.length > 100) return <Virtual {...props} />;
  return (
    <section
      className="oi-table-scroll"
      aria-label={props.caption}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Horizontal scrolling must be available from the keyboard.
      tabIndex={0}
    >
      <table className="oi-data-table" aria-rowcount={props.rows.length + 1}>
        <caption>{props.caption}</caption>
        <thead>
          <tr>
            {props.headings.map((heading) => (
              <th key={heading} scope="col">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.slice(0, 100).map((row, index) => (
            <tr key={row.id} aria-rowindex={index + 2}>
              {row.cells.map((cell, column) => (
                <td key={props.headings[column]}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

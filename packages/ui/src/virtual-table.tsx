"use client";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import type { TableProps } from "./data-table.js";
export function VirtualTable({ caption, headings, rows, headingContent }: TableProps) {
  const parent = useRef<HTMLElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 64,
    overscan: 8,
  });
  const items = virtual.getVirtualItems();
  return (
    <section
      ref={parent}
      className="oi-table-scroll oi-virtual-table"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the virtualized region.
      tabIndex={0}
      aria-label={caption}
    >
      <table className="oi-data-table" aria-rowcount={rows.length + 1}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading} scope="col">
                {headingContent?.[heading] ?? heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: Spacer rows have no focusable content or tabindex. */}
          <tr aria-hidden="true">
            <td colSpan={headings.length} style={{ height: items[0]?.start ?? 0, padding: 0 }} />
          </tr>
          {items.map((item) => (
            <tr
              key={rows[item.index]!.id}
              data-index={item.index}
              ref={virtual.measureElement}
              aria-rowindex={item.index + 2}
            >
              {rows[item.index]!.cells.map((cell, index) => (
                <td key={headings[index]}>{cell}</td>
              ))}
            </tr>
          ))}
          {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: Spacer rows have no focusable content or tabindex. */}
          <tr aria-hidden="true">
            <td
              colSpan={headings.length}
              style={{ height: virtual.getTotalSize() - (items.at(-1)?.end ?? 0), padding: 0 }}
            />
          </tr>
        </tbody>
      </table>
    </section>
  );
}

"use client";
import type { ReactNode } from "react";

// A plain GET form: without JavaScript "Zastosuj" submits it; with JavaScript a changed
// select applies at once. Date inputs still wait for "Zastosuj".
export function FilterForm({ children }: { children: ReactNode }) {
  return (
    <form
      method="get"
      className="oi-filter-form"
      onChange={(event) => {
        if (event.target instanceof HTMLSelectElement) event.currentTarget.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}

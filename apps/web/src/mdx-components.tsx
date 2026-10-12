import type { ComponentProps } from "react";

const components = {
  table: (props: ComponentProps<"table">) => (
    <div className="oi-legal-table">
      <table {...props} />
    </div>
  ),
};
export function useMDXComponents() {
  return components;
}

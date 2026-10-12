import type { MDXComponents } from "mdx/types";
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    table: (props) => (
      <div className="oi-legal-table">
        <table {...props} />
      </div>
    ),
    ...components,
  };
}

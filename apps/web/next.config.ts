import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  pageExtensions: ["ts", "tsx", "mdx"],
};
export default createMDX({ options: { remarkPlugins: ["remark-gfm"] } })(config);

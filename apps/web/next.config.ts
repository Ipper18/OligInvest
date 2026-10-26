import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // Server Function traces include auth arguments (passwords and one-time codes).
  logging: { serverFunctions: false },
  ...(process.env.NODE_ENV === "development"
    ? {
        allowedDevOrigins: ["localhost", "127.0.0.1", "[::1]"],
        // Production routes /api through Caddy; next dev is the local gateway.
        async rewrites() {
          const target = new URL(process.env.API_INTERNAL_URL ?? "");
          // Next's rewrite destination parser treats IPv6 colons as parameter names.
          if (target.hostname === "[::1]") target.hostname = "localhost";
          return [{ source: "/api/:path*", destination: `${target.origin}/api/:path*` }];
        },
      }
    : {}),
  output: "standalone",
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  pageExtensions: ["ts", "tsx", "mdx"],
};
export default createMDX({ options: { remarkPlugins: ["remark-gfm"] } })(config);

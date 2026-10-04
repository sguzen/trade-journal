import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@luxalgo/journal-core", "@luxalgo/journal-importers"],
  serverExternalPackages: ["better-sqlite3"],
  // Runtime journal files belong on the user's disk, never in a deployable bundle.
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "../../outputs/**/*", "../../.runtime-backup*/**/*"],
  },
  /**
   * The built-in prop tracker is retired: Campaign owns accounts, firm rules
   * and payouts via Trading Manager Pro.
   *
   * This is a redirect, not a rewrite. A rewrite would serve another origin's
   * response under this app's path and run before route handlers, which is why
   * the TMP proxy is a route handler instead. A redirect only sends the browser
   * elsewhere and grants no access, so it is safe here. Doing it in config
   * rather than with redirect() in the page gets a real 308 before any
   * rendering — calling redirect() in the page returns HTTP 200 with a
   * client-side redirect payload, because the shell has already streamed.
   */
  async redirects() {
    return [{ source: "/prop-firms", destination: "/campaign", permanent: false }];
  },
};

export default nextConfig;

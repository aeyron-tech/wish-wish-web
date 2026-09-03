import type { NextConfig } from "next";

const pages = process.env.GITHUB_PAGES === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: pages ? "export" : undefined,
  basePath: pages ? "/wish-wish-web" : undefined,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_BASE_PATH: pages ? "/wish-wish-web" : "",
  },
};

export default nextConfig;

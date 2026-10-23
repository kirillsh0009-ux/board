import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `standalone` is only needed for the container/self-hosted server;
  // Vercel builds with its own output tracing.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;

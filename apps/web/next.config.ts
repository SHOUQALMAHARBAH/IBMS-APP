import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal-size production image for Docker — see apps/web/Dockerfile.
  output: "standalone",
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg / ioredis / langfuse 是原生或 Node-only 依赖，不要被打包进 Edge
  serverExternalPackages: ["pg", "ioredis", "langfuse"],
};

export default nextConfig;

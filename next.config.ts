import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 标记本次升级来自安全公告，便于后续 `next upgrade` 识别升级上下文
    agentUpgrade: "security",
  },
  // pg / ioredis / langfuse 是原生或 Node-only 依赖，不要被打包进 Edge
  serverExternalPackages: ["pg", "ioredis", "langfuse"],
};

export default nextConfig;

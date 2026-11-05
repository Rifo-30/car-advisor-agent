import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "node_modules/**", "scripts/dev/**", "next-env.d.ts"]),
  {
    rules: {
      // DB/图状态/第三方 SDK 大量使用 any，降级为警告（仍然可见）
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

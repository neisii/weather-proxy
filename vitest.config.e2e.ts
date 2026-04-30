import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/e2e/**/*.test.ts"],
    typecheck: { tsconfig: "./tsconfig.test.json" },
    testTimeout: 15000,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/core/test/graph-store.test.ts"],
    environment: "node",
    globals: true,
  },
});

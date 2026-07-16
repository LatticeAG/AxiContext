import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@latticeag/axicontext-core": resolve(__dirname, "../core/src/index.ts"),
      "@latticeag/axicontext-parsers": resolve(__dirname, "../parsers/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});

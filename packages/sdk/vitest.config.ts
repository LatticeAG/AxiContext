import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@latticeag/axicontext-adapter-git": resolve(__dirname, "../adapters-git/src/index.ts"),
      "@latticeag/axicontext-core": resolve(__dirname, "../core/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});

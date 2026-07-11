import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@latticeag/axicontext-core": resolve(
        __dirname,
        "packages/core/src/index.ts"
      ),
      "@latticeag/axicontext-server": resolve(
        __dirname,
        "packages/server/src/index.ts"
      )
    }
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: true
  }
});

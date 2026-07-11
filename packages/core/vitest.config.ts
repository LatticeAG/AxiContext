import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/config.test.ts"],
    environment: "node",
  },
});

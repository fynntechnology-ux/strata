import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// `.mts` on purpose: this package is CommonJS, and a `.ts` config gets loaded
// through `require`, which cannot pull in Vitest's ESM-only dependencies on
// Node versions before 20.19.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // World generation tests build a full 614k-voxel claim more than once.
    testTimeout: 30_000,
  },
});

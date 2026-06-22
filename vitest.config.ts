import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig "@/*" -> project root path mapping for tests.
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});

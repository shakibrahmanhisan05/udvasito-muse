import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["tests/**/*.test.{ts,tsx}", "convex/**/*.test.{ts,tsx}"],
  },
});

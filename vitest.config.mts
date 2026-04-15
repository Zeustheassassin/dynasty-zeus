import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    include: ["**/__tests__/**/*.{ts,tsx}", "**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
  },
});

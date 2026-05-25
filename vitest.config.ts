import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    alias: {
      "@app": "/src/app",
      "@features": "/src/features",
      "@widgets": "/src/widgets",
      "@shared": "/src/shared",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src-tauri/**",
        "dist/**",
      ],
    },
  },
});

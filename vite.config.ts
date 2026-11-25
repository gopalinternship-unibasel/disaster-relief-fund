import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";

// Two builds:
//   vite build                 the site in dist/ (any static host, or `npm start`)
//   vite build --mode single   everything in one HTML file that opens by double-click, offline
//   vite build --mode artifact the same file for a hosted preview: memory routing, simulation only
export default defineConfig(({ mode }) => {
  // "single": the one file for double-click use; "artifact": the same, for the hosted preview.
  const single = mode === "single" || mode === "artifact";
  return {
    base: "./",
    plugins: [
      tanstackRouter({ target: "react", autoCodeSplitting: !single, routesDirectory: "src/routes", generatedRouteTree: "src/routeTree.gen.ts" }),
      react(),
      ...(single ? [viteSingleFile({ removeViteModuleLoader: true })] : []),
    ],
    build: {
      outDir: mode === "artifact" ? "dist-artifact" : single ? "dist-single" : "dist",
      emptyOutDir: true,
      target: "es2022",
      chunkSizeWarningLimit: 2000,
      assetsInlineLimit: single ? 100_000_000 : 4096,
    },
    test: {
      include: ["tests/**/*.test.ts"],
      testTimeout: 120_000,
      hookTimeout: 60_000,
    },
  };
});

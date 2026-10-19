import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { defineConfig } from "vitest/config";

// On Windows URL.pathname is "/C:/...", which Node resolves to C:\C:\...; drop the leading slash.
// (No node:url import: this package has no @types/node.)
const ROOT = decodeURIComponent(new URL("../..", import.meta.url).pathname).replace(
  /^\/(?=[A-Za-z]:)/,
  "",
);
const CESIUM = "node_modules/cesium/Build/Cesium";

export default defineConfig(({ mode }) => {
  // Read the repo-root .env; expose ONLY the three browser keys below, mapped explicitly.
  const env = loadEnv(mode, ROOT, "");
  const mapbox = env.MAPBOX_ACCESS_TOKEN ?? "";
  return {
    envDir: ROOT,
    // Only the explicit `define` mapping below may reach the client; no VITE_* var leaks.
    envPrefix: "TL_PUBLIC_",
    plugins: [
      react(),
      tailwindcss(),
      viteStaticCopy({
        targets: ["Workers", "ThirdParty", "Assets", "Widgets"].map((d) => ({
          src: `${CESIUM}/${d}`,
          dest: "cesium",
          // static-copy v4 keeps the source path; strip node_modules/cesium/Build/Cesium so
          // files land at /cesium/<Dir>/... (matching CESIUM_BASE_URL).
          rename: { stripBase: 4 },
        })),
      }),
    ],
    define: {
      CESIUM_BASE_URL: JSON.stringify("/cesium"),
      __GOOGLE_MAPS_API_KEY__: JSON.stringify(env.GOOGLE_MAPS_API_KEY ?? ""),
      __CESIUM_ION_ACCESS_TOKEN__: JSON.stringify(env.CESIUM_ION_ACCESS_TOKEN ?? ""),
      __MAPBOX_ACCESS_TOKEN__: JSON.stringify(mapbox.startsWith("pk.") ? mapbox : ""),
    },
    server: {
      port: Number(env.WEB_PORT || 5173),
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://localhost:${env.API_PORT || 8000}`,
          rewrite: (p: string) => p.replace(/^\/api/, ""),
        },
      },
    },
    test: {
      // Default stays node; DOM tests opt in per file with `// @vitest-environment jsdom`.
      environment: "node",
      setupFiles: ["./src/test/setup.ts"],
      exclude: ["e2e/**", "node_modules/**"],
      // Flake fix (see .superpowers/sdd/journey-sim/reports/FLAKE-report.md). The default is one
      // fork per core minus one (15 here), each paying ~6 s of jsdom/three startup. On a busy
      // machine that oversubscribes CPU and memory: forks failed to spawn (vitest gives up after
      // a fixed 90 s: "Failed to start forks worker", the files then vanish from the run, which is
      // how a run can report 175/182 files with no test failure line) and CPU-bound tests blew the
      // 5 s default. A small cap keeps every worker responsive; wall time barely changes.
      maxWorkers: 6,
      // Several files do real CPU work inside one test (city planning on the Elmina seed, a
      // recursive scan of src/), which is 1-2 s alone and several times that under load.
      testTimeout: 20_000,
      hookTimeout: 30_000,
    },
  };
});

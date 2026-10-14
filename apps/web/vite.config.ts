import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { defineConfig } from "vitest/config";

const ROOT = new URL("../..", import.meta.url).pathname;
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
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          rewrite: (p: string) => p.replace(/^\/api/, ""),
        },
      },
    },
    test: { environment: "node" },
  };
});

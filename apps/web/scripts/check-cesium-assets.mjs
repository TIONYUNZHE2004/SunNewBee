// Fails the build if Cesium static assets are not served from dist/cesium/<Dir>/...
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = new URL("../dist/cesium/", import.meta.url);
const required = [
  "Workers",
  "Assets/approximateTerrainHeights.json",
  "Widgets/widgets.css",
  "ThirdParty",
];
const missing = required.filter((p) => !existsSync(fileURLToPath(new URL(p, dist))));
if (missing.length) {
  console.error(`Cesium assets missing under dist/cesium: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("Cesium assets OK");

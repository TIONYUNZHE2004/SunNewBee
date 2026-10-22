import * as THREE from "three";
import type { MarathonResult } from "../../../closures/closureSimModel";
import { alongLoop, type DetourLine, detourCars } from "../../../closures/detourTraffic";
import { carsAt } from "../../../closures/marathonPlay";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import type { RoleUniforms } from "../assets/roleMaterial";
import { kitMesh, kitPalettes, place } from "../devsim/kit";
import type { LocalFrame } from "../frame";

/** The vehicles kit's car (devsim's compact hatch) and its fallback box (metres). */
const VARIANT = "compact_hatch";
const BOX: [number, number, number] = [1.7, 1.5, 3.9];
/** Cars are drawn this much larger than life, like the people, so they read in the wide shots. */
export const CAR_DISPLAY_SCALE = 1.4;

/**
 * T-031: the rerouted sample cars as 3D cars from the city's vehicles kit (the same instanced kit
 * mesh the Development Simulation parks): the followed car first, the rest looping their detours;
 * then the detour traffic, as many and as slow per detour road as its pressure band
 * (`detourTraffic.ts`). Heading from where each is a moment later. Decorative: never a vehicle
 * count or a delay.
 */
export function createMarathonCars(
  m: MarathonResult,
  frame: LocalFrame,
  kit: { lib?: AssetLibrary | null; manifest?: Manifest | null; roleUniforms: RoleUniforms },
  lines: readonly DetourLine[] = [],
) {
  const trips = m.animation.rerouted_trips ?? [];
  const traffic = detourCars(m, lines);
  const n = Math.max(1, trips.length + traffic.length);
  const k = kitMesh({
    lib: kit.lib,
    manifest: kit.manifest,
    uniforms: kit.roleUniforms,
    asset: "vehicles",
    variant: VARIANT,
    count: n,
    palettes: kitPalettes(kit.manifest, "vehicles"),
    box: BOX,
    kind: "vehicle",
    castShadow: false,
  });
  k.mesh.name = "marathon-cars";
  k.mesh.frustumCulled = false;
  const _m = new THREE.Matrix4();
  let drawn = 0;
  return {
    mesh: k.mesh,
    drawn: () => drawn,
    update(t: number) {
      const now = carsAt(trips, t);
      const soon = carsAt(trips, t + 0.15);
      now.forEach((c, i) => {
        const [x, z] = frame.toLocal(c[0], c[1]);
        const s = soon[i] ?? c;
        const [x2, z2] = frame.toLocal(s[0], s[1]);
        const yaw = Math.hypot(x2 - x, z2 - z) > 1e-3 ? Math.atan2(x2 - x, z2 - z) : 0;
        k.set(i, place(_m, x, 0.05, z, yaw, CAR_DISPLAY_SCALE), i);
      });
      traffic.forEach((c, j) => {
        const l = lines[c.line] as DetourLine;
        const d = t * c.speed + c.offset * l.length;
        const [lon, lat] = alongLoop(l, d);
        const [lon2, lat2] = alongLoop(l, d + 1);
        const [x, z] = frame.toLocal(lon, lat);
        const [x2, z2] = frame.toLocal(lon2, lat2);
        const yaw = Math.hypot(x2 - x, z2 - z) > 1e-3 ? Math.atan2(x2 - x, z2 - z) : 0;
        k.set(now.length + j, place(_m, x, 0.05, z, yaw, CAR_DISPLAY_SCALE), j + 1);
      });
      drawn = now.length + traffic.length;
      k.setCount(drawn);
    },
    dispose: k.dispose,
  };
}

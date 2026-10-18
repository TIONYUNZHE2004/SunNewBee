import { type RefObject, useEffect, useRef, useState } from "react";
import type { InstancedMesh } from "three";
import { usePerfStats } from "../../cesium/PerfOverlay";
import type { Tier } from "../../cesium/stylised/quality";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { Engine } from "../engine";
import { createFacadeLayer, type FacadeBuilding } from "../facade/facadeLayer";
import { type ActiveTile, measure } from "../stream/streamer";
import { whenIdle } from "./idle";
import { ASSET_WARN } from "./useCityAssets";

/** The engine decor slot that holds the procedural facade layer. */
export const FACADE_SLOT = "facades";
const MB = 1024 * 1024;
/** User Timing name of one facade layer build (idle callback, after a ring 0-1 change). */
export const FACADE_MEASURE = "tl:stream-facades";

/** Instance buffers (matrix + colour) of the facade layer's meshes. */
const facadeBytes = (group: { children: unknown[] }) => {
  let n = 0;
  for (const c of group.children) {
    const m = c as Partial<Pick<InstancedMesh, "instanceMatrix" | "instanceColor">>;
    n += (m.instanceMatrix?.array.byteLength ?? 0) + (m.instanceColor?.array.byteLength ?? 0);
  }
  return n;
};

/** The facade lists of the ring 0-1 tiles whose plan carries facades (fresh ring 0-1 plans only). */
export function nearFacades(active: ActiveTile[]): FacadeBuilding[][] {
  const out: FacadeBuilding[][] = [];
  for (const a of active) if (a.ring <= 1 && a.content.facades) out.push(a.content.facades);
  return out;
}

const sameLists = (a: FacadeBuilding[][], b: FacadeBuilding[][]) =>
  a.length === b.length && a.every((l, i) => l === b[i]);

/**
 * Procedural facades (decorative), streamed per tile (P4-H): one layer for the extrusions in the
 * tiles at ring <= 1 of the camera target; farther tiles show the plain palette extrusion. The
 * layer is rebuilt only when that set of tile plans changes, in an idle callback (the palette
 * extrusion shows meanwhile), with the live role and motion uniforms (mood and flicker reach it
 * without a rebuild). It never casts shadows. Low draws none.
 */
export function useFacades({
  engine,
  active,
  tier,
  roleUniforms,
  baseBytes,
}: {
  engine: Engine | null;
  active: ActiveTile[];
  tier: Tier;
  roleUniforms: RoleUniforms;
  /** The city's GPU bytes without the facade layer (for the perf line). */
  baseBytes: RefObject<number>;
}) {
  const listsRef = useRef<FacadeBuilding[][]>([]);
  const next = tier === "low" ? [] : nearFacades(active);
  if (!sameLists(next, listsRef.current)) listsRef.current = next;
  const lists = listsRef.current;
  const [facadesOn, setFacadesOn] = useState(false);

  useEffect(() => {
    if (!engine) return;
    const total = lists.reduce((n, l) => n + l.length, 0);
    if (total === 0) {
      engine.setDecor(FACADE_SLOT, null);
      setFacadesOn(false);
      usePerfStats.getState().update({ gpuMB: baseBytes.current / MB });
      return;
    }
    // The previous layer stays drawn until this one replaces it (the slot disposes it): no flash.
    return whenIdle(() => {
      let layer: ReturnType<typeof createFacadeLayer>;
      const t0 = performance.now();
      try {
        layer = createFacadeLayer(lists.flat(), roleUniforms, tier, engine.motion);
        measure(FACADE_MEASURE, t0);
      } catch (err) {
        // Decorative only: the palette extrusion stays drawn without it.
        console.warn(`${ASSET_WARN}: facades: ${String(err)}`);
        engine.setDecor(FACADE_SLOT, null);
        setFacadesOn(false);
        return;
      }
      engine.setDecor(FACADE_SLOT, layer);
      setFacadesOn(layer.group.children.length > 0);
      usePerfStats
        .getState()
        .update({ gpuMB: (baseBytes.current + facadeBytes(layer.group)) / MB });
    });
  }, [engine, lists, tier, roleUniforms, baseBytes]);
  // An engine switch or unmount clears the slot.
  useEffect(() => {
    if (!engine) return;
    return () => {
      engine.setDecor(FACADE_SLOT, null);
      setFacadesOn(false);
    };
  }, [engine]);

  return { facadesOn };
}

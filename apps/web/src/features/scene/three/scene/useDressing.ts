import { useEffect, useMemo, useRef, useState } from "react";
import { type BuildingsLayer, useStreetFurniture } from "../../../../lib/api";
import type { Tier } from "../../shared/quality";
import { createDressingLayer, type DressingLayer } from "../dressing/dressingLayer";
import {
  type DressItem,
  factItems,
  planDecorProps,
  planFactProps,
  walkLines,
} from "../dressing/dressingPlan";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import type { Boundary } from "../ground/boundary";
import type { LayerData } from "./useGround";

/** The dressing is drawn within this distance (m) of the camera target (B-T8 adds the bubble). */
export const DRESS_GATE_M = 150;
/** Decorative props are re-planned when the focus moves this far from the last plan's centre. */
export const DRESS_REPLAN_M = 25;
/** Decorative props are planned this far past the gate, so a re-plan is rarely visible. */
const PLAN_PAD_M = DRESS_REPLAN_M + 10;
/** Beyond this camera range the dressing is too small to see: none is drawn. */
export const DRESS_MAX_RANGE_M = 1500;

export interface DressingCounts {
  facts: number;
  decor: number;
  triangles: number;
}

/**
 * The street dressing kit (B-T7): fact props from `/layers/street_furniture` and the walk
 * `crossing` edges (all tiers), and seeded decorative props (High and Medium) planned around the
 * camera target. Mounted only near the camera target (`DRESS_GATE_M`), instanced, one layer.
 * Returns what is drawn, so the scene shows "Decorative details are illustrative." whenever a
 * decorative prop is.
 */
export function useDressing({
  engine,
  frame,
  tier,
  walk,
  buildings,
  boundary = null,
  showroom = false,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  tier: Tier;
  walk: LayerData | undefined;
  buildings: BuildingsLayer | null | undefined;
  boundary?: Boundary | null;
  showroom?: boolean;
}): DressingCounts {
  const furniture = useStreetFurniture(!showroom).data;
  const lines = useMemo(() => (walk && frame ? walkLines(walk, frame) : null), [walk, frame]);
  const facts = useMemo<DressItem[]>(
    () =>
      lines && frame
        ? factItems(
            planFactProps({
              furniture: furniture?.furniture ?? null,
              walk: null,
              lines,
              frame,
              boundary,
            }),
          )
        : [],
    [lines, frame, furniture, boundary],
  );
  const rich = tier !== "low";
  const [counts, setCounts] = useState<DressingCounts>({ facts: 0, decor: 0, triangles: 0 });
  const layerRef = useRef<DressingLayer | null>(null);

  useEffect(() => {
    if (!engine || !frame || !lines || showroom) return;
    const layer = createDressingLayer({ tier });
    layerRef.current = layer;
    engine.setDecor("dressing", layer);
    let planAt: [number, number] | null = null;
    let decor: DressItem[] = [];
    const publish = (c: DressingCounts) =>
      setCounts((p) =>
        p.facts === c.facts && p.decor === c.decor && p.triangles === c.triangles ? p : c,
      );
    const off = engine.onLodTick((t) => {
      const focus: [number, number] | null =
        t.rangeM <= DRESS_MAX_RANGE_M ? [t.target.x, t.target.z] : null;
      if (focus && rich) {
        if (!planAt || Math.hypot(focus[0] - planAt[0], focus[1] - planAt[1]) > DRESS_REPLAN_M) {
          planAt = focus;
          const r = DRESS_GATE_M + PLAN_PAD_M;
          decor = planDecorProps({
            lines,
            parks: buildings?.parks ?? null,
            buildings: buildings?.buildings ?? null,
            frame,
            boundary,
            box: [focus[0] - r, focus[1] - r, focus[0] + r, focus[1] + r],
          });
        }
      }
      layer.setItems(rich ? [...facts, ...decor] : facts);
      const s = layer.update(focus, DRESS_GATE_M);
      engine.requestRender();
      publish({ facts: s.facts, decor: s.decor, triangles: s.triangles });
      return false;
    });
    engine.requestLodTick();
    return () => {
      off();
      layerRef.current = null;
      engine.setDecor("dressing", null);
      publish({ facts: 0, decor: 0, triangles: 0 });
    };
  }, [engine, frame, lines, facts, buildings, boundary, tier, rich, showroom]);

  return counts;
}

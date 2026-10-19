import { useEffect, useMemo, useState } from "react";
import { type BuildingsLayer, useStreetFurniture } from "../../../../lib/api";
import type { Tier } from "../../shared/quality";
import { createBubbleFader, type DetailBubble } from "../detailBubble";
import { createDressingLayer } from "../dressing/dressingLayer";
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

/** Decorative props are re-planned when the bubble's focus moves this far from the last plan's centre. */
export const DRESS_REPLAN_M = 25;
/** Decorative props are planned this far past the bubble, so items leave the plan only once faded. */
const PLAN_PAD_M = DRESS_REPLAN_M + 10;

export interface DressingCounts {
  facts: number;
  decor: number;
  triangles: number;
}

/**
 * The street dressing kit (B-T7) inside the detail bubble (B-T8): fact props from
 * `/layers/street_furniture` and the walk `crossing` edges (all tiers), and seeded decorative props
 * (High and Medium) planned around the bubble's focus. Mounted only inside the bubble, instanced,
 * one layer; each instance fades in / out over `BUBBLE_FADE_S` at the bubble edge (scaled by its
 * weight, frames requested while any fade runs). Returns what is drawn, so the scene shows
 * "Decorative details are illustrative." whenever a decorative prop is.
 */
export function useDressing({
  engine,
  frame,
  tier,
  walk,
  buildings,
  bubble,
  boundary = null,
  showroom = false,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  tier: Tier;
  walk: LayerData | undefined;
  buildings: BuildingsLayer | null | undefined;
  bubble: DetailBubble;
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

  useEffect(() => {
    if (!engine || !frame || !lines || showroom) return;
    const layer = createDressingLayer({ tier });
    engine.setDecor("dressing", layer);
    const fader = createBubbleFader();
    let focus: [number, number] | null = null;
    let planAt: [number, number] | null = null;
    let decor: DressItem[] = [];
    const publish = (c: DressingCounts) =>
      setCounts((p) =>
        p.facts === c.facts && p.decor === c.decor && p.triangles === c.triangles ? p : c,
      );
    // One fade pass: every candidate's weight steps toward in / out of the bubble.
    const pass = () => {
      fader.begin();
      const now = performance.now();
      const r = bubble.radiusM;
      const st = layer.update(focus, r, (it, d) => fader.weight(it.key, d <= r, now));
      fader.prune();
      engine.requestRender();
      publish({ facts: st.facts, decor: st.decor, triangles: st.triangles });
    };
    const offBubble = bubble.register((b) => {
      focus = b.focus;
      if (focus && rich) {
        if (!planAt || Math.hypot(focus[0] - planAt[0], focus[1] - planAt[1]) > DRESS_REPLAN_M) {
          planAt = focus;
          const r = b.radiusM + PLAN_PAD_M;
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
      pass();
    });
    // While a fade runs, every rendered frame steps it and asks for the next frame.
    const offFrame = engine.onFrame(() => {
      if (fader.fading()) pass();
    });
    return () => {
      offBubble();
      offFrame();
      engine.setDecor("dressing", null);
      publish({ facts: 0, decor: 0, triangles: 0 });
    };
  }, [engine, frame, lines, facts, buildings, boundary, tier, rich, showroom, bubble]);

  return counts;
}

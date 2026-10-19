import { type BubbleFader, createBubbleFader } from "../detailBubble";
import { dressingFadeProbe } from "../fadeProbe";
import type { DressingLayer, DressingStats } from "./dressingLayer";
import type { DressItem } from "./dressingPlan";

/**
 * Drives the dressing layer's bubble fade (AC-B9). Decorative props are planned around the bubble
 * and re-planned as it moves; an instance that leaves the plan is not dropped: it is kept as
 * "retiring" and fades out over `BUBBLE_FADE_S` while the new plan's instances fade in, so a
 * re-plan is a cross-fade, never a pop. Fact props (benches, signals, bus stops, shelters,
 * zebras) are data: they are never retired, and a decorative re-plan does not touch them.
 */
export interface DressingDriver {
  /** Hands in the fact props (fixed) and the current decorative plan (replaced on every re-plan). */
  setPlan(facts: readonly DressItem[], decor: readonly DressItem[]): void;
  /** One fade pass at `nowMs` for the bubble (focus null: everything fades out). */
  pass(focus: readonly [number, number] | null, radiusM: number, nowMs: number): DressingStats;
  /** True while any instance is between its weight and its target (the next frame is needed). */
  fading(): boolean;
  /** Decorative instances still retiring (old plan, fading out). */
  retiring(): number;
}

export function createDressingDriver(
  layer: DressingLayer,
  fader: BubbleFader = createBubbleFader(),
): DressingDriver {
  let facts: readonly DressItem[] = [];
  let decor: readonly DressItem[] = [];
  const retiring = new Map<string, DressItem>();
  const isFact = new Set<string>();

  const push = () => layer.setItems([...facts, ...decor, ...retiring.values()]);

  return {
    setPlan(nextFacts, nextDecor) {
      facts = nextFacts;
      isFact.clear();
      for (const f of facts) isFact.add(f.key);
      const keep = new Set(nextDecor.map((d) => d.key));
      for (const d of decor) if (!keep.has(d.key)) retiring.set(d.key, d);
      for (const k of keep) retiring.delete(k);
      decor = nextDecor;
      push();
    },
    pass(focus, radiusM, nowMs) {
      fader.begin();
      const zero: string[] = [];
      const st = layer.update(focus, radiusM, (it, d) => {
        const out = retiring.has(it.key);
        const w = fader.weight(it.key, !out && d <= radiusM, nowMs);
        if (out && w <= 0) zero.push(it.key);
        return w;
      });
      fader.prune();
      dressingFadeProbe.maxW = st.decorMaxW;
      dressingFadeProbe.decor = st.decor;
      dressingFadeProbe.nowMs = nowMs;
      if (zero.length > 0) {
        for (const k of zero) retiring.delete(k);
        push();
      }
      return st;
    },
    fading: () => fader.fading(),
    retiring: () => retiring.size,
  };
}

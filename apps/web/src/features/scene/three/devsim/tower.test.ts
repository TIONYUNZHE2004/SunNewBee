import { describe, expect, it } from "vitest";
import plan from "../../../devsim/fixtures/plan.provisional.json";
import type { DevelopmentPlan, StateAt } from "../../../devsim/types";
import { createRoleUniforms } from "../assets/roleMaterial";
import { createFrame } from "../frame";
import { siteGeom, TOWER_STOREY_M } from "./geom";
import { stateAt } from "./state";
import { createTower, litRank } from "./tower";

const P = plan as DevelopmentPlan;
const frame = createFrame([101.5076, 3.1794]);
const geom = siteGeom(P, frame);

function tower() {
  return createTower({ geom, roleUniforms: createRoleUniforms() });
}
const frameAt = (s: StateAt, night = 0) => ({ s, t: 0, night });

describe("devsim tower", () => {
  it("the drawn floor count follows floorsBuilt (rounded up; the top floor rises in part)", () => {
    const tw = tower();
    const base = stateAt(20, P);
    for (const fb of [0, 1, 7.4, 15, 29.2, 30]) {
      tw.update(frameAt({ ...base, floorsBuilt: fb }));
      expect(tw.floorsShown()).toBe(Math.ceil(fb));
      expect(tw.topM()).toBeCloseTo(fb * TOWER_STOREY_M, 6);
    }
    tw.dispose();
  });

  it("follows the timeline: no floors at the start, all floors when Construction ends", () => {
    const tw = tower();
    tw.update(frameAt(stateAt(2, P)));
    expect(tw.floorsShown()).toBe(0);
    tw.update(frameAt(stateAt(33, P)));
    expect(tw.floorsShown()).toBe(P.site.storeys);
    tw.dispose();
  });

  it("window emissive is exactly 0 while the lit fraction is 0, even at night (Q4)", () => {
    const tw = tower();
    for (let t = 0; t < 32; t += 0.25) {
      const s = stateAt(t, P);
      tw.update(frameAt(s, 1));
      expect(s.windowsLitFraction).toBe(0);
      expect(tw.windowUniforms.uWindowGlow.value).toBe(0);
      expect(tw.windowUniforms.uLitShare.value).toBe(0);
      expect(tw.litFraction()).toBe(0);
    }
    tw.update(frameAt({ ...stateAt(40, P), windowsLitFraction: 0.5 }, 1));
    expect(tw.windowUniforms.uWindowGlow.value).toBeGreaterThan(0);
    expect(tw.windowUniforms.uLitShare.value).toBe(0.5);
    tw.dispose();
  });

  it("floors light in a fixed rank order (a permutation of the floors)", () => {
    const r = litRank(30);
    expect([...r].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(litRank(30)).toEqual(r);
  });

  it("is never lit by a site light: the tower part holds no light", () => {
    const tw = tower();
    let lights = 0;
    tw.group.traverse((o) => {
      if ((o as { isLight?: boolean }).isLight) lights++;
    });
    expect(lights).toBe(0);
    tw.dispose();
  });
});

import { expect, test } from "@playwright/test";
import { BOOKMARK_NAMES, gotoBookmark } from "./support/bookmarks";

/** `ThreeScene.tsx` DECORATIVE_NOTE (not imported: the spec runs in Node without the scene bundle). */
const DECORATIVE_NOTE = "Decorative details are illustrative.";

/**
 * AC-B7 / AC-B8 (task B-T7) on the Elmina seed, Stylised map. The vitest halves are
 * `dressing/dressingPlan.test.ts` (one fact prop per data feature inside the boundary, each with
 * its source id) and `dressing/importBoundary.test.ts` (journey modules never import dressing).
 * Here, at every acceptance bookmark (camera poses at the beat places until Phase D), the scene
 * reports what the dressing draws (`data-dressing-facts` / `data-dressing-decor`), and whenever a
 * decorative prop is drawn the "Decorative details are illustrative." note is on screen.
 * Run (GPU, dev server on the seed):
 * `ACCEPTANCE_BASE_URL=http://localhost:5185 pnpm --filter @tl/web acceptance -g "AC-B7|AC-B8"`.
 */
for (const name of BOOKMARK_NAMES)
  test(`AC-B7|AC-B8: dressing and the decorative note at ${name}`, async ({ page }) => {
    await gotoBookmark(page, name);
    const scene = page.getByTestId("three-scene");
    const decor = Number(await scene.getAttribute("data-dressing-decor"));
    const facts = Number(await scene.getAttribute("data-dressing-facts"));
    expect(Number.isFinite(decor) && Number.isFinite(facts)).toBe(true);
    if (decor > 0) await expect(page.getByRole("note", { name: DECORATIVE_NOTE })).toBeVisible();
  });

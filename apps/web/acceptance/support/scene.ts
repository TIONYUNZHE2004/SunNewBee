import type { Page } from "@playwright/test";
import { HOOK } from "./bookmarks";
import type { Point, RGBAImage } from "./pixels";

/** Surface kinds a pick mask can select (`three/pick.ts` for buildings, road mesh / ground plane rays otherwise). */
export type MaskKind = "building" | "ground" | "road" | "sky" | "other";
const CODE: Record<MaskKind, string> = {
  sky: ".",
  ground: "g",
  road: "r",
  building: "b",
  other: "o",
};

export interface PickMask {
  kind: MaskKind;
  /** Sample spacing in CSS pixels. */
  step: number;
  /** Page-pixel points (cell centres) whose pick is `kind`; points under UI chrome are left out. */
  points: Point[];
  /** Grid cells that were on the canvas and not under UI. */
  total: number;
}

/** One pick per grid cell over the canvas (see `pickMask`); reuse it for several kinds. */
export interface PickGrid {
  step: number;
  cols: number;
  rows: number;
  /** One code per cell, row-major (mirrors `maskCode` in `useAcceptanceHook.ts`). */
  codes: string;
  /** Cell is under DOM chrome (panel, controls, chips), not the canvas. */
  ui: boolean[];
  left: number;
  top: number;
}

/**
 * Samples the canvas every `step` CSS pixels: building = `pickAt` (three/pick.ts) hits a building
 * or landmark; road = a ray hits a road-surface mesh; ground = the ground plane; sky = nothing.
 * Each sample is a full raycast (about 4-5 ms on the seed at High), so the default step 12 takes
 * about 40 s at 1440x900; step 8 about 90 s.
 */
export async function pickGrid(page: Page, step = 12): Promise<PickGrid> {
  return page.evaluate(
    ({ h, step }) => {
      const api = (window as unknown as Record<string, unknown>)[h] as
        | { pickGrid(s: number): { step: number; cols: number; rows: number; codes: string } }
        | undefined;
      if (!api) throw new Error(`${h} missing: load the map with ?acceptance=1`);
      const canvas = document.querySelector('[data-testid="three-scene"] canvas');
      if (!canvas) throw new Error("no three.js canvas");
      const rect = canvas.getBoundingClientRect();
      const g = api.pickGrid(step);
      const ui: boolean[] = [];
      for (let row = 0; row < g.rows; row++)
        for (let col = 0; col < g.cols; col++) {
          const x = rect.left + (col + 0.5) * step;
          const y = rect.top + (row + 0.5) * step;
          ui.push(document.elementFromPoint(x, y) !== canvas);
        }
      return { ...g, ui, left: rect.left, top: rect.top };
    },
    { h: HOOK, step },
  );
}

/** The page points of `grid` whose surface is `kind`, leaving out cells under UI chrome. */
export function maskOf(grid: PickGrid, kind: MaskKind): PickMask {
  const want = CODE[kind];
  const points: Point[] = [];
  let total = 0;
  for (let i = 0; i < grid.codes.length; i++) {
    if (grid.ui[i]) continue;
    total++;
    if (grid.codes[i] !== want) continue;
    const col = i % grid.cols;
    const row = Math.floor(i / grid.cols);
    points.push({
      x: Math.floor(grid.left + (col + 0.5) * grid.step),
      y: Math.floor(grid.top + (row + 0.5) * grid.step),
    });
  }
  return { kind, step: grid.step, points, total };
}

/** Page points (on a `step` grid) whose pick is `kind`: building / ground / road (or sky / other). */
export async function pickMask(page: Page, kind: MaskKind, step = 12): Promise<PickMask> {
  return maskOf(await pickGrid(page, step), kind);
}

/** A PNG screenshot decoded to RGBA in the page (no Node image library needed). */
export async function decodePng(page: Page, png: Buffer): Promise<RGBAImage> {
  const r = await page.evaluate(async (b64: string) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none" });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext("2d", { colorSpace: "srgb" });
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let s = "";
    for (let i = 0; i < d.length; i += 0x8000)
      s += String.fromCharCode(...d.subarray(i, Math.min(d.length, i + 0x8000)));
    return { width: bmp.width, height: bmp.height, b64: btoa(s) };
  }, png.toString("base64"));
  return { width: r.width, height: r.height, data: new Uint8Array(Buffer.from(r.b64, "base64")) };
}

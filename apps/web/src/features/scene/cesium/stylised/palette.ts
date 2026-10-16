export type { Theme } from "../../../../ui/theme";

import type { Theme } from "../../../../ui/theme";
import { mixHex } from "./colour";

export interface Palette {
  ground: string;
  road: string;
  /** Flat classification bands beside roads, parks and lakes (decorative, never raised). */
  pavement: string;
  kerb: string;
  roadMark: string;
  park: string;
  parkEdge: string;
  shore: string;
  /** Decorative base water (lakes, rivers): teal-grey, deliberately unlike the flood-scenario blue. */
  water: string;
  sky: string;
  /** Fog density (exponential, per metre). */
  fog: number;
  tree: [string, string];
  trunk: string;
  /** Static parked cars (decorative). */
  car: [string, string, string];
  wall: { warm: string; cool: string; rose: string };
  roof: { warm: string; cool: string; rose: string };
  windowLit: [string, string];
  windowDark: string;
  sun: { dir: [number, number, number]; color: string; intensity: number };
  ambient: number;
  /** Window emission, 0 to 1. */
  glow: number;
  /** Share of windows that are lit. */
  litFrac: number;
  light: {
    key: string;
    fill: string;
    bounce: string;
    /** ENU direction the key light travels (same convention as `sun.dir`). */
    keyDir: [number, number, number];
    keyIntensity: number;
    ambient: number;
  };
  /** CSS sky gradient behind the transparent canvas. */
  skyTop: string;
  horizon: string;
  shadows: boolean;
  bloom: boolean;
}

const NIGHT: Palette = {
  ground: "#1a1430",
  road: "#2f2a45",
  pavement: "#2a2148",
  kerb: "#463a74",
  roadMark: "#6d5fa3",
  park: "#1f4a45",
  parkEdge: "#2c6158",
  shore: "#3c6e66",
  water: "#2b5750",
  sky: "#1f1838",
  fog: 0.0004,
  tree: ["#2f8c7e", "#1d5a5f"],
  trunk: "#3b2b55",
  car: ["#c8628c", "#4f78c8", "#d8c9a6"],
  wall: { warm: "#4a3b82", cool: "#4f4590", rose: "#6a4377" },
  roof: { warm: "#8c76c6", cool: "#a98bd0", rose: "#d98ca8" },
  windowLit: ["#f6be64", "#fdf0ea"],
  windowDark: "#0c081e",
  sun: { dir: [0.4, -0.5, -0.25], color: "#8fa6ff", intensity: 0.6 },
  ambient: 0.35,
  glow: 1,
  litFrac: 0.58,
  light: {
    key: "#8fa6ff",
    fill: "#3d2f6b",
    bounce: "#1a1430",
    keyDir: [0.4, -0.5, -0.25],
    keyIntensity: 0.35,
    ambient: 0.4,
  },
  skyTop: "#120d26",
  horizon: "#3d2f6b",
  shadows: false,
  bloom: true,
};

const DAY: Palette = {
  ground: "#e8dccf",
  road: "#8f8a9e",
  pavement: "#d8cdc4",
  kerb: "#a89cb4",
  roadMark: "#f4efe6",
  park: "#a9d39a",
  parkEdge: "#7fb478",
  shore: "#cfe6df",
  water: "#8fb8b0",
  sky: "#9bc4e8",
  fog: 0.00025,
  tree: ["#5fb88a", "#3b8c66"],
  trunk: "#8a6a55",
  car: ["#e0686a", "#5a8fd9", "#f4f1ea"],
  wall: { warm: "#e9c9a8", cool: "#c9c4ea", rose: "#f0b8c4" },
  roof: { warm: "#c08a6a", cool: "#8f86c4", rose: "#d9788f" },
  windowLit: ["#fff3c4", "#cfe7ff"],
  windowDark: "#5a5280",
  sun: { dir: [0.5, -0.6, -0.8], color: "#fff1d6", intensity: 2.2 },
  ambient: 0.8,
  glow: 0,
  litFrac: 0.35,
  light: {
    key: "#fff1d6",
    fill: "#cfe3ff",
    bounce: "#e8dccf",
    keyDir: [0.5, -0.6, -0.8],
    keyIntensity: 0.85,
    ambient: 0.55,
  },
  skyTop: "#7fb2e5",
  horizon: "#e9f1f7",
  shadows: true,
  bloom: false,
};

const DUSK: Palette = {
  ground: "#d9b9b4",
  road: "#6f6684",
  pavement: "#c9aaa8",
  kerb: "#8a7598",
  roadMark: "#f3dccb",
  park: "#86b38a",
  parkEdge: "#5f9470",
  shore: "#9fc5c3",
  water: "#5f8f93",
  sky: "#c98aa6",
  fog: 0.0003,
  tree: ["#4f9a7a", "#2f7466"],
  trunk: "#6a4a55",
  car: ["#e0686a", "#5a8fd9", "#f4f1ea"],
  wall: { warm: "#e3b49a", cool: "#a99ad6", rose: "#e7a2b4" },
  roof: { warm: "#b4745e", cool: "#7f70b8", rose: "#cc6c86" },
  windowLit: ["#ffd08a", "#fff0dc"],
  windowDark: "#3d2f6b",
  sun: { dir: [0.75, -0.2, -0.3], color: "#ffb38a", intensity: 1.4 },
  ambient: 0.6,
  glow: 0.6,
  litFrac: 0.45,
  light: {
    key: "#ffb38a",
    fill: "#8f8be0",
    bounce: "#d9a7a0",
    keyDir: [0.75, -0.2, -0.3],
    keyIntensity: 0.9,
    ambient: 0.45,
  },
  skyTop: "#6f5aa8",
  horizon: "#f8cdb0",
  shadows: true,
  bloom: true,
};

const PALETTES: Record<Theme, Palette> = { day: DAY, dusk: DUSK, night: NIGHT };
export const paletteFor = (t: Theme): Palette => PALETTES[t] ?? NIGHT;

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

function lerpAny(a: unknown, b: unknown, t: number): unknown {
  if (isHex(a) && isHex(b)) return mixHex(a, b, t);
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length)
    return a.every(isHex)
      ? a.map((v, i) => mixHex(v as string, b[i] as string, t))
      : t < 0.5
        ? a
        : b;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(a)) out[k] = lerpAny((a as never)[k], (b as never)[k], t);
    return out;
  }
  return t < 0.5 ? a : b;
}

/** Palette between a (t=0) and b (t=1): colours mixed, numbers lerped, flags switch at 0.5. */
export const lerpPalette = (a: Palette, b: Palette, t: number): Palette =>
  t <= 0 ? a : t >= 1 ? b : (lerpAny(a, b, t) as Palette);

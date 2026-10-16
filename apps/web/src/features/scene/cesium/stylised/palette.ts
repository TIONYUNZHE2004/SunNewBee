export type { Theme } from "../../../../ui/theme";

import type { Theme } from "../../../../ui/theme";

export interface Palette {
  ground: string;
  road: string;
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
}

const NIGHT: Palette = {
  ground: "#1a1430",
  road: "#372b62",
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
};

const DAY: Palette = {
  ground: "#e8dccf",
  road: "#9a8fb0",
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
};

const DUSK: Palette = {
  ground: "#d9b9b4",
  road: "#7d6a92",
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
};

const PALETTES: Record<Theme, Palette> = { day: DAY, dusk: DUSK, night: NIGHT };
export const paletteFor = (t: Theme): Palette => PALETTES[t] ?? NIGHT;

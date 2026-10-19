import { applyTheme, useTheme } from "../../ui/theme";
import { usePanel } from "../main/panelStore";
import { useSceneSettings } from "../scene/sceneSettingsStore";
import { useScene } from "../scene/sceneStore";

/** True when the URL carries the demo recording flag `?demo=1` (spec section 6.6). One helper for
 * everything that keys off it (this preset, the later `window.__journey` gating and auto-play). */
export function isDemoPreset(
  search: string = typeof location === "undefined" ? "" : location.search,
): boolean {
  return new URLSearchParams(search).get("demo") === "1";
}

/** The values the preset forces for this page load. */
export const DEMO_PRESET = {
  mapStyle: "stylised",
  quality: "high",
  theme: "day",
  pathStatus: false,
  assistantOpen: true,
} as const;

/**
 * Forces the recording look in memory only. It uses `setState`, never the store setters, so the
 * user's stored settings (`tl.quality`, `tl.pathStatus`, `tl.theme`, `tl.panel.open`) are untouched
 * and come back on the next normal load. Returns whether the preset was applied.
 */
export function applyDemoPreset(search?: string): boolean {
  if (!isDemoPreset(search)) return false;
  useSceneSettings.setState({ quality: DEMO_PRESET.quality, pathStatus: DEMO_PRESET.pathStatus });
  useScene.setState({ mapStyle: DEMO_PRESET.mapStyle, mapStyleChosen: true });
  useTheme.setState({ choice: DEMO_PRESET.theme, theme: DEMO_PRESET.theme });
  if (typeof document !== "undefined") applyTheme(DEMO_PRESET.theme);
  usePanel.setState({ open: DEMO_PRESET.assistantOpen });
  return true;
}

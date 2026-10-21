import type { RefObject } from "react";
import { useMapInsets } from "../journey/useMapInsets";
import { useScene } from "../scene/sceneStore";
import { DevsimOverlay } from "./DevsimOverlay";
import { useDevsim } from "./devsimStore";
import { useDevsimDriver } from "./useDevsimDriver";

const fallbackSize = (): [number, number] =>
  typeof window === "undefined" ? [1024, 768] : [window.innerWidth, window.innerHeight];

/**
 * Development Simulation mount for a map renderer (follows `JourneyMount`): while the devsim store
 * is active it runs the shared frame driver and shows the DOM overlay over the map at `hostRef`.
 * The 3D lane mounts it in the Three.js scene and feeds `useDevsimAnchors` each frame.
 */
export function DevsimMount({
  hostRef,
  decorativeNote = true,
}: {
  /** The map element (anchors and probe rects are relative to it; insets read from it). */
  hostRef?: RefObject<HTMLElement | null>;
  /** False when the renderer already shows "Decorative details are illustrative.". */
  decorativeNote?: boolean;
}) {
  useDevsimDriver();
  const active = useDevsim((s) => s.status !== "idle");
  const { viewport } = useMapInsets(hostRef, active, fallbackSize);
  if (!active) return null;
  return (
    <DevsimOverlay
      stageRef={hostRef}
      viewport={viewport}
      decorativeNote={decorativeNote}
      onClose={() => useScene.getState().stopDevsim()}
    />
  );
}

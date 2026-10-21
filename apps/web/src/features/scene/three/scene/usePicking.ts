import { type RefObject, useEffect, useRef } from "react";
import type { LonLat } from "../../geo";
import { useScene } from "../../sceneStore";
import type { Engine } from "../engine";
import { applyPick, LINE_PICK_PX, pickAt } from "../pick";

/** A pointer that moves further than this between down and up is a drag (the camera rig), not a click. */
const CLICK_DRAG_PX = 4;

/**
 * Click to pick (one shared picker, fixed priority). Only a primary-button press released within
 * CLICK_DRAG_PX is a click; a drag orbits (MapControls) and a second finger cancels the click.
 * Each primary press starts afresh, so a press released outside the map never goes stale.
 */
export function usePicking({
  engine,
  hostRef,
  places,
}: {
  engine: Engine | null;
  hostRef: RefObject<HTMLDivElement | null>;
  places: Map<string, LonLat>;
}) {
  const placesRef = useRef(places);
  placesRef.current = places;
  useEffect(() => {
    const host = hostRef.current;
    if (!engine || !host) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.isPrimary && e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || !e.isPrimary || e.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_DRAG_PX) return;
      const r = host.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return;
      const ndc = {
        x: ((e.clientX - r.left) / r.width) * 2 - 1,
        y: -((e.clientY - r.top) / r.height) * 2 + 1,
      };
      // split screen: the camera of the half under the click
      const v = engine.pickView({ x: e.clientX - r.left, y: e.clientY - r.top });
      const hit = pickAt(ndc, v.camera, v.roots, LINE_PICK_PX, {
        width: v.size[0],
        height: v.size[1],
      });
      if (hit) applyPick(hit, useScene.getState(), (id) => placesRef.current.has(id));
    };
    const onCancel = () => {
      down = null;
    };
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onCancel);
    return () => {
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onCancel);
    };
  }, [engine, hostRef]);
}

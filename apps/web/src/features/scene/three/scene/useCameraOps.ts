import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { usePanel } from "../../../main/panelStore";
import { isWide } from "../../../main/usePanelReserve";
import { mapPanelOverlapPx } from "../../../main/viewport";
import { type CameraOps, reducedMotion } from "../../cesium/controls/cameraOps";
import type { LonLat } from "../../geo";
import { useScene } from "../../sceneStore";
import { BOOKMARKS, bookmarkFromSearch, DEFAULT_BOOKMARK } from "../bookmarks";
import { createThreeCameraOps, type Pose, type ThreeCameraOps, VFOV_DEG } from "../cameraRig";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import { boundsGoal, type CameraGoal, intentGoal } from "../intents";

const INTENT_PITCH_DEG = -45;
const WHOLE_PITCH_DEG = -50;
const FLY_MS = 1800;
const RAD = Math.PI / 180;

const goalPose = (g: CameraGoal, frame: LocalFrame, pitchDeg: number): Pose => ({
  target: frame.toLocal(g.centre[0], g.centre[1]),
  rangeM: g.rangeM,
  pitchDeg,
  headingDeg: 0,
});

/** The start view: `?bookmark=` when given, else the default gate bookmark. */
function startPose(frame: LocalFrame): Pose {
  const b = BOOKMARKS[bookmarkFromSearch(location.search) ?? DEFAULT_BOOKMARK];
  return {
    target: frame.toLocal(b.centre[0], b.centre[1]),
    rangeM: b.rangeM,
    pitchDeg: b.pitchDeg,
    headingDeg: b.headingDeg,
  };
}

const bboxCorners = (b: number[] | undefined): LonLat[] =>
  b?.length === 4
    ? [
        [b[0] as number, b[1] as number],
        [b[2] as number, b[3] as number],
      ]
    : [];

const SHOWROOM_MIN_RANGE_M = 150;
/** A top-down-ish view that fits a local xz box inside the 30 degree vertical field of view. */
export function fitPose(b: { min: [number, number]; max: [number, number] }): Pose {
  const radius = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2;
  return {
    target: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2],
    rangeM: Math.max(SHOWROOM_MIN_RANGE_M, (radius / Math.tan((VFOV_DEG / 2) * RAD)) * 1.1),
    pitchDeg: WHOLE_PITCH_DEG,
    headingDeg: 0,
  };
}

/**
 * The camera: the start view (once per engine), scene intents to camera moves, the look point left
 * of the side panel, and the camera actions (buttons, keyboard, double-click) handed to `onOps`.
 */
export function useCameraOps({
  engine,
  frame,
  bbox,
  places,
  hostRef,
  onOps,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  bbox: number[] | undefined;
  places: Map<string, LonLat>;
  hostRef: RefObject<HTMLDivElement | null>;
  onOps?: (ops: CameraOps | null) => void;
}) {
  const panelOpen = usePanel((s) => s.open);
  const placesRef = useRef(places);
  placesRef.current = places;
  const focusPoint = useCallback((id: string) => placesRef.current.get(id) ?? null, []);

  // Frame the start view once per engine, as soon as the local frame exists.
  const framed = useRef<Engine | null>(null);
  useEffect(() => {
    if (!engine || !frame || framed.current === engine) return;
    framed.current = engine;
    engine.rig.set(startPose(frame));
  }, [engine, frame]);

  // Scene intents to camera moves (same precedence as cesium/camera.ts).
  useEffect(() => {
    if (!engine || !frame) return;
    return useScene.subscribe((s, prev) => {
      const goal = intentGoal(s, prev, focusPoint);
      if (!goal) return;
      const pose = goalPose(goal, frame, INTENT_PITCH_DEG);
      if (reducedMotion()) engine.rig.set(pose);
      else engine.rig.flyTo(pose, FLY_MS);
    });
  }, [engine, frame, focusPoint]);

  // Look point in the middle of the map area left of the side panel (phones use the sheet).
  useEffect(() => {
    if (!engine) return;
    const panel = mapPanelOverlapPx(panelOpen, isWide(), innerWidth);
    engine.setViewOffset(panel);
  }, [engine, panelOpen]);

  // Camera actions (buttons, keyboard, double-click).
  const startRef = useRef<() => Pose>(() => ({
    target: [0, 0],
    rangeM: 1200,
    pitchDeg: -35,
    headingDeg: 0,
  }));
  const wholeRef = useRef<() => Pose>(startRef.current);
  if (frame) {
    startRef.current = () => startPose(frame);
    wholeRef.current = () => {
      const g = boundsGoal(bboxCorners(bbox)) ?? {
        centre: BOOKMARKS.township.centre,
        rangeM: BOOKMARKS.township.rangeM,
      };
      return goalPose(g, frame, WHOLE_PITCH_DEG);
    };
  }
  const [ops, setOps] = useState<ThreeCameraOps | null>(null);
  const onOpsRef = useRef(onOps);
  onOpsRef.current = onOps;
  useEffect(() => {
    if (!engine) return;
    const o = createThreeCameraOps(
      engine.rig,
      () => startRef.current(),
      () => wholeRef.current(),
    );
    setOps(o);
    onOpsRef.current?.(o);
    // Double-click glides in to the ground point under the pointer (as on the Cesium map).
    const host = hostRef.current;
    const onDblClick = (e: MouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      o.glideTo({ x: e.clientX - r.left, y: e.clientY - r.top });
    };
    host?.addEventListener("dblclick", onDblClick);
    return () => {
      host?.removeEventListener("dblclick", onDblClick);
      setOps(null);
      onOpsRef.current?.(null);
    };
  }, [engine, hostRef]);

  return { ops };
}

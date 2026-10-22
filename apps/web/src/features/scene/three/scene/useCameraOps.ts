import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { usePanel } from "../../../main/panelStore";
import { isWide } from "../../../main/usePanelReserve";
import { mapPanelOverlapPx } from "../../../main/viewport";
import { type CameraOps, reducedMotion } from "../../cesium/controls/cameraOps";
import type { LonLat } from "../../geo";
import { useScene } from "../../sceneStore";
import { BOOKMARKS, bookmarkFromSearch, DEFAULT_BOOKMARK } from "../bookmarks";
import { overviewPose } from "../cameraFit";
import {
  type CameraFit,
  createThreeCameraOps,
  type Pose,
  type ThreeCameraOps,
  VFOV_DEG,
} from "../cameraRig";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import { anchorInside } from "../ground/boundary";
import { boundsGoal, type CameraGoal, type IntentSlice, intentGoal } from "../intents";

const INTENT_PITCH_DEG = -45;
const WHOLE_PITCH_DEG = -50;
const FLY_MS = 1800;
const RAD = Math.PI / 180;

/** No intent at all: diffing against it yields the intent standing in the store. */
const NO_INTENT: IntentSlice = {
  route: null,
  focusRouteRequest: null,
  whatIf: null,
  focusPlaceId: null,
  camera: null,
};

const goalPose = (g: CameraGoal, frame: LocalFrame, pitchDeg: number): Pose => ({
  target: frame.toLocal(g.centre[0], g.centre[1]),
  rangeM: g.rangeM,
  pitchDeg,
  headingDeg: 0,
});

/**
 * A camera placed on the overview's stand-in before the slab's camera fit landed (the static
 * `township` start, or "Whole township" pressed early): the input serial at that moment.
 */
export interface PendingOverview {
  serial: number;
}

/**
 * When the fit lands (A-T5 fix round 2): the overview to ease to, if the camera still stands on the
 * stand-in (no user input and no other camera move since); else null (the engine then only eases
 * the camera into the fit's rules where it is). Pure.
 */
export function overviewOnFit(
  pending: PendingOverview | null,
  serialNow: number,
  fit: CameraFit,
): Pose | null {
  return pending && pending.serial === serialNow ? overviewPose(fit) : null;
}

/**
 * The start view: `?bookmark=` when given, else the default gate bookmark. `township` is the
 * overview derived from the slab outline when the engine has its camera fit (A-T5); before that,
 * the static stand-in, and `onStandIn` is told (the fit-ready handler re-poses it).
 */
function startPose(frame: LocalFrame, engine: Engine | null, onStandIn?: () => void): Pose {
  const id = bookmarkFromSearch(location.search) ?? DEFAULT_BOOKMARK;
  const fit = engine?.cameraFit?.();
  if (id === "township" && fit) return overviewPose(fit);
  if (id === "township") onStandIn?.();
  const b = BOOKMARKS[id];
  // Kept >= 300 m inside the outline whatever it is (A-T5: survives outline edits).
  const local = frame.toLocal(b.centre[0], b.centre[1]);
  const outline = engine?.slabBoundary?.();
  return {
    target: (outline ? anchorInside(outline, local[0], local[1]) : null) ?? local,
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
 * The camera: the standing intent else the start view (once per engine), scene intents to camera
 * moves, the look point left of the side panel, and the camera actions (buttons, keyboard,
 * double-click) handed to `onOps`.
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

  // The overview stand-in waiting for the slab's camera fit (A-T5 fix round 2).
  const pending = useRef<PendingOverview | null>(null);
  const standIn = useCallback(() => {
    pending.current = { serial: engine?.inputSerial?.() ?? 0 };
  }, [engine]);

  // Frame once per engine, as soon as the local frame exists: on the intent standing in the store
  // (e.g. a route drawn before a style switch), else the start view.
  const framed = useRef<Engine | null>(null);
  useEffect(() => {
    if (!engine || !frame || framed.current === engine) return;
    framed.current = engine;
    const standing = intentGoal(useScene.getState(), NO_INTENT, focusPoint);
    pending.current = null;
    engine.rig.set(
      standing ? goalPose(standing, frame, INTENT_PITCH_DEG) : startPose(frame, engine, standIn),
    );
  }, [engine, frame, focusPoint, standIn]);

  // When the slab's camera fit lands: a camera still on the overview stand-in eases to the derived
  // overview; any other camera is eased into the fit's rules by the engine (no one-frame snap).
  useEffect(() => {
    if (!engine?.onFitReady) return;
    return engine.onFitReady((fit) => {
      const pose = overviewOnFit(pending.current, engine.inputSerial?.() ?? 0, fit);
      pending.current = null;
      if (!pose) return;
      if (reducedMotion()) engine.rig.set(pose);
      else engine.rig.flyTo(pose, FLY_MS);
    });
  }, [engine]);

  // Scene intents to camera moves (same precedence as cesium/camera.ts).
  useEffect(() => {
    if (!engine || !frame) return;
    return useScene.subscribe((s, prev) => {
      const goal = intentGoal(s, prev, focusPoint);
      if (!goal) return;
      pending.current = null; // the camera is going somewhere else
      const pose = goalPose(goal, frame, INTENT_PITCH_DEG);
      if (reducedMotion()) engine.rig.set(pose);
      else engine.rig.flyTo(pose, FLY_MS);
    });
  }, [engine, frame, focusPoint]);

  // Look point in the middle of the map area left of the side panel (phones use the sheet). The
  // Development Simulation's camera frames its own subject in the map area its overlays leave
  // clear (the driver's view offset, V2 fix B-a; spec 2026-10-21 §6.2, AC-W6).
  useEffect(() => {
    if (!engine) return;
    engine.setViewOffset(mapPanelOverlapPx(panelOpen, isWide(), innerWidth));
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
    startRef.current = () => {
      pending.current = null;
      return startPose(frame, engine, standIn);
    };
    wholeRef.current = () => {
      // With a slab (A-T5): the whole slab at max range, derived from the outline. Before its fit
      // lands, the bbox stand-in (re-posed when the fit lands, if nothing moved the camera since).
      const fit = engine?.cameraFit?.();
      if (fit) return overviewPose(fit);
      standIn();
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
      // Camera buttons and keys count as user input (cancels a pending overview re-pose).
      () => engine.noteInput?.(),
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

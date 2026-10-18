import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { BuildingsLayer } from "../../../../lib/api";
import type { Tier } from "../../cesium/stylised/quality";
import type { RoofInput } from "../assets/plan";
import type { Engine } from "../engine";
import type { FacadeBuilding } from "../facade/facadeLayer";
import type { LocalFrame } from "../frame";
import {
  type ActiveTile,
  createStreamer,
  MERGE_MEASURE,
  measure,
  type Streamer,
  type TileContent,
} from "../stream/streamer";
import {
  bucketFacades,
  bucketRoofs,
  planTile,
  type TileInputs,
  warmPlanners,
} from "../stream/tilePlan";
import { TILE_M, tileAt } from "../stream/tiles";
import { whenIdle } from "./idle";
import type { LoadedAssets } from "./useCityAssets";
import type { LayerData } from "./useGround";

const NONE: ActiveTile[] = [];

/**
 * While the streamer is still filling (`pending`), the merged layers (kits, lamp pools, signs,
 * agents, roads, facades, roofs) are rebuilt at most this often: each rebuild walks every active tile, so
 * one per planned tile would be main-thread work proportional to the tile count on every tick. A
 * new ring-0 plan and the end of a fill are published at once; outside a fill every change is.
 */
export const MERGE_INTERVAL_MS = 1000;

/** Whether a streamed change is handed to the merged layers now (see MERGE_INTERVAL_MS). */
export function shouldMerge(s: {
  pending: boolean;
  ring0Changed: boolean;
  sinceLastMs: number;
}): boolean {
  return !s.pending || s.ring0Changed || s.sinceLastMs >= MERGE_INTERVAL_MS;
}

/**
 * The township streamer on the engine's LOD schedule: each LOD tick hands it the orbit target and
 * range, it plans at most one 250 m tile (the hitch budget), and the active tiles (ring 0 first)
 * come back as React state whenever they change. The hooks that draw props, lamp pools, signs,
 * agents, roads and facades merge `active` into their layers.
 *
 * The planners' layer caches are warmed once per input set in an idle callback before the first
 * streamed tick, so no tick pays their cold cost. A tier change or new input data (the manifest,
 * the facade inputs) invalidates every tile; the old content stays drawn until each re-plan.
 */
export function useStream({
  engine,
  frame,
  tier,
  detailsOn,
  walk,
  buildings,
  loaded,
  showroom,
  facadeSrc,
  roofSrc = null,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  tier: Tier;
  detailsOn: boolean;
  walk: LayerData | undefined;
  buildings: BuildingsLayer | null | undefined;
  loaded: LoadedAssets | null;
  showroom: boolean;
  facadeSrc: FacadeBuilding[] | null;
  /** Roof inputs (Task 8); null or absent: no roof dressing. */
  roofSrc?: RoofInput[] | null;
}) {
  const facades = useMemo(() => (facadeSrc ? bucketFacades(facadeSrc) : null), [facadeSrc]);
  const roofs = useMemo(() => (roofSrc ? bucketRoofs(roofSrc) : null), [roofSrc]);
  const manifest = loaded?.manifest ?? null;
  const inputs = useMemo<TileInputs | null>(
    () =>
      frame && detailsOn && walk && !showroom
        ? { frame, walk, buildings, manifest, facades, roofs }
        : null,
    [frame, detailsOn, walk, showroom, buildings, manifest, facades, roofs],
  );
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const tierRef = useRef(tier);
  tierRef.current = tier;

  const [active, setActive] = useState<ActiveTile[]>(NONE);
  /** Local centre of the tile under the camera target (ambient life follows it). */
  const [centre, setCentre] = useState<[number, number] | null>(null);
  /** The input set whose planner caches are warm; the streamer ticks only for it. */
  const [warm, setWarm] = useState<TileInputs | null>(null);
  const streamerRef = useRef<Streamer | null>(null);

  // One streamer per engine. It plans from the live inputs (a ref): new inputs invalidate it.
  useEffect(() => {
    if (!engine) return;
    const s = createStreamer(
      (tile, ring, t) => planTile(inputsRef.current as TileInputs, tile, ring, t),
      { initialTier: tierRef.current },
    );
    streamerRef.current = s;
    return () => {
      streamerRef.current = null;
      s.dispose();
      setActive(NONE);
      setCentre(null);
    };
  }, [engine]);

  // Warm the planners' layer caches once per input set, outside any streamed frame.
  useEffect(() => {
    if (!inputs) {
      setWarm(null);
      return;
    }
    return whenIdle(() => {
      warmPlanners(inputs);
      setWarm(inputs);
    });
  }, [inputs]);

  // New inputs or a tier change: every tile is re-planned (old content shows until then).
  useEffect(() => {
    const s = streamerRef.current;
    if (!engine || !s || !warm) return;
    s.setTier(tier);
    s.invalidate();
    engine.requestLodTick();
  }, [engine, warm, tier]);

  // The LOD tick: at most one tile per call; merged-layer rebuilds coalesced while filling.
  const mergeStart = useRef<number | null>(null);
  useEffect(() => {
    if (!engine || !warm) return;
    let centreKey = "";
    let dirty = false;
    let lastMerge = Number.NEGATIVE_INFINITY;
    let mergedRing0: TileContent | null = null;
    return engine.onLodTick((t) => {
      const s = streamerRef.current;
      if (!s || inputsRef.current !== warm) return false;
      const r = s.update(t.target, t.rangeM);
      if (r.changed) dirty = true;
      if (dirty) {
        const next = s.active();
        const ring0 = next[0]?.ring === 0 ? next[0].content : null;
        if (
          shouldMerge({
            pending: r.pending,
            ring0Changed: ring0 !== mergedRing0,
            sinceLastMs: t.nowMs - lastMerge,
          })
        ) {
          dirty = false;
          lastMerge = t.nowMs;
          mergedRing0 = ring0;
          mergeStart.current = performance.now();
          setActive(next);
        }
      }
      const c = tileAt(t.target.x, t.target.z);
      if (c.key !== centreKey) {
        centreKey = c.key;
        setCentre([(c.i + 0.5) * TILE_M, (c.j + 0.5) * TILE_M]);
      }
      return r.pending || dirty;
    });
  }, [engine, warm]);

  // Streaming off (showroom, no walk yet): nothing is drawn from it.
  const shown = inputs ? active : NONE;
  return { active: shown, centre, mergeStart };
}

/**
 * Times one merge of the streamed layers as the User Timing measure `tl:stream-merge`: from the
 * LOD tick that published the active tiles to the end of the effects that rebuilt the layers. Call
 * it after the hooks that merge `active` (effects run in declaration order).
 */
export function useMergeMeasure(active: ActiveTile[], mergeStart: RefObject<number | null>) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` is the trigger
  useEffect(() => {
    const t0 = mergeStart.current;
    if (t0 === null) return;
    mergeStart.current = null;
    measure(MERGE_MEASURE, t0);
  }, [active, mergeStart]);
}

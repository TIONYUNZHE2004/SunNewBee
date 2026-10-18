import { useEffect, useMemo, useRef, useState } from "react";
import type { BuildingsLayer } from "../../../../lib/api";
import type { Tier } from "../../cesium/stylised/quality";
import type { Engine } from "../engine";
import type { FacadeBuilding } from "../facade/facadeLayer";
import type { LocalFrame } from "../frame";
import { type ActiveTile, createStreamer, type Streamer } from "../stream/streamer";
import { bucketFacades, planTile, type TileInputs, warmPlanners } from "../stream/tilePlan";
import { TILE_M, tileAt } from "../stream/tiles";
import type { LoadedAssets } from "./useCityAssets";
import type { LayerData } from "./useGround";

const NONE: ActiveTile[] = [];

/** Runs `fn` when the main thread is idle (at most 500 ms later); returns a cancel function. */
function whenIdle(fn: () => void): () => void {
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (h: number) => void;
  };
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const h = w.requestIdleCallback(fn, { timeout: 500 });
    return () => w.cancelIdleCallback?.(h);
  }
  const t = setTimeout(fn, 0);
  return () => clearTimeout(t);
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
}) {
  const facades = useMemo(() => (facadeSrc ? bucketFacades(facadeSrc) : null), [facadeSrc]);
  const manifest = loaded?.manifest ?? null;
  const inputs = useMemo<TileInputs | null>(
    () =>
      frame && detailsOn && walk && !showroom
        ? { frame, walk, buildings, manifest, facades }
        : null,
    [frame, detailsOn, walk, showroom, buildings, manifest, facades],
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

  // The LOD tick: at most one tile per call.
  useEffect(() => {
    if (!engine || !warm) return;
    let centreKey = "";
    return engine.onLodTick((t) => {
      const s = streamerRef.current;
      if (!s || inputsRef.current !== warm) return false;
      const r = s.update(t.target, t.rangeM, t.nowMs);
      if (r.changed) setActive(s.active());
      const c = tileAt(t.target.x, t.target.z);
      if (c.key !== centreKey) {
        centreKey = c.key;
        setCentre([(c.i + 0.5) * TILE_M, (c.j + 0.5) * TILE_M]);
      }
      return r.pending;
    });
  }, [engine, warm]);

  // Streaming off (showroom, no walk yet): nothing is drawn from it.
  const shown = inputs ? active : NONE;
  return { active: shown, centre };
}

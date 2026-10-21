import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useScene } from "../../sceneStore";
import type { Tier } from "../../shared/quality";
import { createAmbient } from "../ambient/ambient";
import type { Placement } from "../assets/fit";
import type { RoleUniforms } from "../assets/roleMaterial";
import { type Suppress, suppressKits } from "../devsim/suppress";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import type { Boundary } from "../ground/boundary";
import { createLampPools } from "../props/lampPools";
import { createSignLayer, signLayerSteps } from "../signs/signLayer";
import type { SignPlacement } from "../signs/signPlan";
import { type ActiveTile, timed, UNION_MEASURE } from "../stream/streamer";
import { mergeQueueOf, type SliceJob } from "./idle";
import type { SceneBus } from "./sceneBus";
import { unionById, unionKits } from "./union";

/**
 * Decorative detail from the streamed tiles: their props (the union handed to the city instances
 * through `setKits`, rebuilt only when the active set changes), lamp light pools, sourced shop
 * signs (one batched layer), and the ambient birds and cloud shadows, which follow the tile under
 * the camera target. Low draws none of it.
 */
export function useDecor({
  engine,
  frame,
  tier,
  active,
  centre,
  showroom,
  roleUniforms,
  setKits,
  kitJob,
  bus,
  boundary = null,
  suppress = null,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  tier: Tier;
  active: ActiveTile[];
  /** Local centre of the tile under the camera target (null before the first LOD tick). */
  centre: [number, number] | null;
  showroom: boolean;
  roleUniforms: RoleUniforms;
  setKits: (kits: Map<string, Placement[]> | null) => void;
  /** `setKits` as a time-sliced job (one step per kit key); absent: sliced rebuilds use `setKits` whole. */
  kitJob?: (kits: Map<string, Placement[]> | null) => SliceJob | null;
  bus: SceneBus;
  /** The Elmina outline (A-T4): birds and cloud shadows outside it are hidden. */
  boundary?: Boundary | null;
  /** Devsim: the city's construction props inside this area are not drawn (`devsim/suppress.ts`). */
  suppress?: Suppress | null;
}) {
  const rich = tier !== "low";
  // Stale content can outlive a switch to Low for a few ticks (until its re-plan): gate it here.
  const kits = useMemo(
    () =>
      rich
        ? timed(UNION_MEASURE, () => suppressKits(unionKits(active), suppress))
        : new Map<string, Placement[]>(),
    [active, rich, suppress],
  );

  // Only the kit buckets of the city instances are rebuilt (the city mesh and archetypes are kept).
  // Like every merged layer, sliced once the merges are slow (`mergeQueueOf`).
  useEffect(() => {
    if (showroom) return;
    const apply = () => timed("tl:stream-kits", () => setKits(kits));
    if (!engine) {
      apply();
      return;
    }
    const q = mergeQueueOf(engine);
    if (!q.sliced || !kitJob) return q.run("kits", apply);
    // Sliced: one kit key a step, swapped in when every key is built.
    const job = kitJob(kits);
    return job ? q.runSteps("kits", job) : undefined;
  }, [engine, kits, setKits, kitJob, showroom]);

  // Lamp light pools (one instanced draw, from the active tiles' lamps). Decorative.
  const lamps = useMemo(
    () => (rich ? timed(UNION_MEASURE, () => unionById(active, (a) => a.content.lamps)) : []),
    [active, rich],
  );
  useEffect(() => {
    if (!engine) return;
    if (lamps.length === 0) {
      engine.setDecor("lamp-pools", null);
      return;
    }
    return mergeQueueOf(engine).run("lamp-pools", () => {
      const pools = timed("tl:stream-lamps", () => createLampPools(lamps, roleUniforms));
      const group = new THREE.Group();
      group.name = "lamp-pools";
      group.add(pools.mesh);
      engine.setDecor("lamp-pools", { group, dispose: pools.dispose });
    });
  }, [engine, lamps, roleUniforms]);

  // Sourced, text-only shop signs: a sign without text, source_url and as_of never reaches the
  // client (the API filters) and is dropped again in the plan. The layer is rebuilt only when the
  // set of sign ids changes (a re-plan with the same signs, e.g. Medium <-> High, keeps it).
  const signList = useMemo(
    () =>
      rich
        ? timed(UNION_MEASURE, () => unionById<SignPlacement>(active, (a) => a.content.signs))
        : [],
    [active, rich],
  );
  const signKey = signList.map((s) => s.id).join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ids, not the array
  const signs = useMemo(() => signList, [signKey]);
  useEffect(() => {
    if (!engine || signs.length === 0) {
      engine?.setDecor("signs", null);
      // No signs drawn: no card either.
      if (useScene.getState().selectedSignId !== null) useScene.getState().selectSign(null);
      return;
    }
    const show = (layer: { group: THREE.Group; dispose(): void }) => {
      engine.setDecor("signs", layer);
      engine.requestRender();
      // A card must not outlive its sign: close it if the sign left the active tiles.
      const open = useScene.getState().selectedSignId;
      if (open !== null && !signs.some((s) => s.id === open)) useScene.getState().selectSign(null);
    };
    const q = mergeQueueOf(engine);
    if (!q.sliced)
      return q.run("signs", () =>
        show(timed("tl:stream-signs", () => createSignLayer(signs, roleUniforms))),
      );
    // Sliced: a few signs a step (text and quads), the layer swapped in when complete.
    const build = signLayerSteps(signs, roleUniforms);
    return q.runSteps("signs", {
      steps: build.steps,
      done: () => show(build.layer),
      cancel: () => build.layer.dispose(),
    });
  }, [engine, signs, roleUniforms]);
  // An engine switch or unmount clears the merged slots (a rebuild replaces a layer in place).
  useEffect(() => {
    if (!engine) return;
    return () => {
      engine.setDecor("lamp-pools", null);
      engine.setDecor("signs", null);
    };
  }, [engine]);
  // Unmount (or engine switch): no card without the scene.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `engine` is the trigger (an engine switch closes the card)
  useEffect(
    () => () => {
      useScene.getState().selectSign(null);
    },
    [engine],
  );

  // Birds and cloud shadows, built around the frame origin and moved with the tile under the
  // camera target. The motion clock ticks them; while it is stopped the driver re-ticks them at
  // the frozen time on each mood change, so their day/night visibility stays right.
  const centreRef = useRef(centre);
  centreRef.current = centre;
  const ambientRef = useRef<ReturnType<typeof createAmbient> | null>(null);
  useEffect(() => {
    // None at Low (Review Focus 5); counts follow the tier.
    if (!engine || !frame || showroom || tier === "low") return;
    const ambient = createAmbient(tier, frame, frame.toLonLat(0, 0), "ambient", boundary);
    const c = centreRef.current;
    if (c) ambient.group.position.set(c[0], 0, c[1]);
    ambient.tick(performance.now(), bus.getState().mood);
    ambientRef.current = ambient;
    bus.setState({ ambient });
    engine.setDecor("ambient", ambient);
    return () => {
      ambientRef.current = null;
      bus.setState({ ambient: null });
      engine.setDecor("ambient", null);
    };
  }, [engine, frame, showroom, tier, bus, boundary]);
  useEffect(() => {
    const ambient = ambientRef.current;
    if (!engine || !ambient || !centre) return;
    ambient.group.position.set(centre[0], 0, centre[1]);
    ambient.refresh();
    engine.requestRender();
  }, [engine, centre]);

  return { kits };
}

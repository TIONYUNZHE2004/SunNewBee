import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { BuildingsLayer } from "../../../../lib/api";
import type { Tier } from "../../cesium/stylised/quality";
import { useScene } from "../../sceneStore";
import { createAmbient } from "../ambient/ambient";
import type { Placement } from "../assets/fit";
import type { RoleUniforms } from "../assets/roleMaterial";
import { HERO_CENTRE, HERO_RADIUS_M } from "../bookmarks";
import type { Engine } from "../engine";
import type { LocalFrame } from "../frame";
import { PROP_CAPS } from "../props/caps";
import { createLampPools } from "../props/lampPools";
import { planProps } from "../props/propsPlan";
import { createSignLayer } from "../signs/signLayer";
import { planSigns } from "../signs/signPlan";
import { boxAround } from "../stream/area";
import type { SceneBus } from "./sceneBus";
import type { LoadedAssets } from "./useCityAssets";
import type { LayerData } from "./useGround";

/** The square box covering the P3 hero circle: the planners' area until Task 4 streams tiles. */
export const heroBox = (frame: LocalFrame) => {
  const [x, z] = frame.toLocal(HERO_CENTRE[0], HERO_CENTRE[1]);
  return boxAround(x, z, HERO_RADIUS_M);
};

/**
 * Decorative detail: the hero district's props (handed to the city instances through `setKits`),
 * lamp light pools, sourced shop signs, and the ambient birds and cloud shadows.
 */
export function useDecor({
  engine,
  frame,
  tier,
  detailsOn,
  walk,
  buildings,
  loaded,
  showroom,
  roleUniforms,
  setKits,
  bus,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  tier: Tier;
  detailsOn: boolean;
  walk: LayerData | undefined;
  buildings: BuildingsLayer | null | undefined;
  loaded: LoadedAssets | null;
  showroom: boolean;
  roleUniforms: RoleUniforms;
  setKits: (kits: Map<string, Placement[]> | null) => void;
  bus: SceneBus;
}) {
  // Seeded static props (trees, lamps, furniture, construction) for the hero district. Planned once
  // the buildings, land cover and walk are all in, from data that does not depend on profile or
  // scenario, and re-planned when the quality tier changes (PROP_CAPS[tier]; none at Low).
  // Decorative only.
  const propsPlan = useMemo(
    () =>
      frame && detailsOn && walk && buildings && loaded && !showroom
        ? planProps({
            walk,
            landcover: buildings.landcover,
            buildings: buildings.buildings,
            parks: buildings.parks,
            trees: buildings.trees,
            places: walk,
            frame,
            // Until the streamer plans per tile (Task 4): one box covering the P3 hero circle,
            // with the P3 hero totals as caps.
            area: { box: heroBox(frame), seed: "props" },
            tier,
            caps: PROP_CAPS[tier],
            m: loaded.manifest,
          })
        : null,
    [frame, detailsOn, walk, buildings, loaded, showroom, tier],
  );

  // Props arrive after the city's first frame, and are re-planned on a tier change: only the kit
  // buckets of the city instances are rebuilt (the city mesh and the archetypes are kept).
  useEffect(() => {
    if (propsPlan) setKits(propsPlan.kits);
  }, [propsPlan, setKits]);

  // Lamp light pools (one instanced draw, from the planned lamps). Decorative; the engine slot
  // disposes them when the props are re-planned or the scene goes away.
  useEffect(() => {
    if (!engine || !propsPlan) return;
    const lamps = [
      ...(propsPlan.kits.get("furniture/lamp_single") ?? []),
      ...(propsPlan.kits.get("furniture/lamp_double") ?? []),
    ];
    if (lamps.length === 0) return;
    const pools = createLampPools(lamps, roleUniforms);
    const group = new THREE.Group();
    group.name = "lamp-pools";
    group.add(pools.mesh);
    engine.setDecor("lamp-pools", { group, dispose: pools.dispose });
    return () => engine.setDecor("lamp-pools", null);
  }, [engine, propsPlan, roleUniforms]);

  // Sourced, text-only shop signs: a sign without text, source_url and as_of never reaches the
  // client (the API filters) and is dropped again in the plan. Planned once the walk is in, for the hero district only and none at Low.
  // Keyed on "not Low", not the tier: a Medium <-> High change must not rebuild the signs (and
  // close an open sign card).
  const signsOn = tier !== "low";
  const signPlan = useMemo(
    () =>
      frame && detailsOn && walk && buildings && !showroom && signsOn
        ? planSigns(buildings.signage, buildings.buildings, walk, frame, {
            area: { box: heroBox(frame), seed: "signs" },
          })
        : null,
    [frame, detailsOn, walk, buildings, showroom, signsOn],
  );
  useEffect(() => {
    if (!engine || !signPlan || signPlan.signs.length === 0) return;
    const layer = createSignLayer(signPlan.signs, roleUniforms);
    engine.setDecor("signs", layer);
    engine.requestRender();
    return () => {
      engine.setDecor("signs", null);
      // A card must not outlive its signs.
      useScene.getState().selectSign(null);
    };
  }, [engine, signPlan, roleUniforms]);

  // Birds and cloud shadows. The motion clock ticks them; while it is stopped the driver re-ticks
  // them at the frozen time on each mood change, so their day/night visibility stays right.
  useEffect(() => {
    // None at Low (Review Focus 5); counts follow the tier.
    if (!engine || !frame || showroom || tier === "low") return;
    const ambient = createAmbient(tier, frame, HERO_CENTRE, "ambient");
    ambient.tick(performance.now(), bus.getState().mood);
    bus.setState({ ambient });
    engine.setDecor("ambient", ambient);
    return () => {
      bus.setState({ ambient: null });
      engine.setDecor("ambient", null);
    };
  }, [engine, frame, showroom, tier, bus]);

  return { propsPlan };
}

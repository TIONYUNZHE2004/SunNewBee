import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { MarathonResult } from "../../../closures/closureSimModel";
import { boundaryJunctions } from "../../../closures/courseDressing";
import { detourLines } from "../../../closures/detourTraffic";
import {
  MAX_SUGGESTION_TAGS,
  suggestionRoad,
  suggestionTag,
} from "../../../closures/marathonCinematic";
import { useMarathonPlay } from "../../../closures/marathonPlayStore";
import { parseLayer } from "../../list/listModel";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import type { RoleUniforms } from "../assets/roleMaterial";
import { VFOV_DEG } from "../cameraRig";
import type { CameraDriver, Engine } from "../engine";
import type { LocalFrame } from "../frame";
import type { CrowdKit } from "../motion/crowdBake";
import { CROWD_LOAD_TIMEOUT_MS, loadCrowdKit } from "../motion/crowdKit";
import type { OverlayLayer } from "../overlays/accessLayers";
import { createMarathonRunners, type PlayTag } from "../overlays/marathonRunners";
import type { LayerData } from "../scene/useGround";
import { createCinematicCamera } from "./cinematicCamera";
import { localPath } from "./crowdLayout";
import { createMarathonCars } from "./marathonCars";
import { createMarathonCrowd } from "./marathonCrowd";

/** What the sample cars need from the city's loaded assets. */
export interface VehicleKit {
  lib?: AssetLibrary | null;
  manifest?: Manifest | null;
  roleUniforms: RoleUniforms;
}

/**
 * Suggestion tags for the map: suggestions about one place (marshal, signpost, crossing point)
 * whose text names a detour road, at the middle of that road's first stretch on the access layer;
 * one per road, at most MAX_SUGGESTION_TAGS. Every suggestion is also on the end card.
 */
export function suggestionTags(
  m: MarathonResult,
  edges: readonly { id: string; coords: number[][] }[],
): PlayTag[] {
  const byId = new Map(edges.map((e) => [e.id, e.coords]));
  const out: PlayTag[] = [];
  const used = new Set<string>();
  for (const s of m.impact.suggestions) {
    const text = suggestionTag(s.kind);
    const road = text ? suggestionRoad(m, s.text) : null;
    if (!text || !road || used.has(road)) continue;
    const seg = m.impact.detour_roads.find((r) => r.name === road)?.segment_ids[0];
    const coords = seg ? byId.get(seg) : undefined;
    const mid = coords?.[Math.floor(coords.length / 2)];
    if (!mid) continue;
    used.add(road);
    out.push({ text, at: [mid[0] ?? 0, mid[1] ?? 0] });
    if (out.length === MAX_SUGGESTION_TAGS) break;
  }
  return out;
}

/**
 * T-031 "Watch the marathon" in the Stylised 3D view: while a playback is loaded, its layer rides
 * the overlay pass and its one cinematic camera drives the engine's camera (`setCameraDriver`,
 * as the journey follow camera does). Exit hands the camera back to the rig where it stands.
 */
export function useMarathonCinematic(
  engine: Engine | null,
  overlay: OverlayLayer | null,
  frame: LocalFrame | null,
  accessData: LayerData | undefined,
  vehicleKit: VehicleKit | null = null,
): void {
  const marathon = useMarathonPlay((s) => s.result);
  // the kit's parts, so a new wrapper object each render does not rebuild the scene
  const lib = vehicleKit?.lib;
  const manifest = vehicleKit?.manifest;
  const roleUniforms = vehicleKit?.roleUniforms;
  const tags = useMemo(
    () => (marathon && accessData ? suggestionTags(marathon, parseLayer(accessData).edges) : []),
    [marathon, accessData],
  );
  // the crowd kit for the 3D runners and spectators (loaded once a playback is shown)
  const [kit, setKit] = useState<CrowdKit | null>(null);
  const wantKit = !!marathon && !!engine;
  useEffect(() => {
    if (!wantKit || kit || import.meta.env.MODE === "test") return;
    const ac = new AbortController();
    let live = true;
    loadCrowdKit({ signal: ac.signal, timeoutMs: CROWD_LOAD_TIMEOUT_MS }).then(
      (k) => {
        if (live) setKit(k);
        else k.dispose();
      },
      () => {}, // no kit: the runner dots stay
    );
    return () => {
      live = false;
      ac.abort();
    };
  }, [wantKit, kit]);
  useEffect(() => () => kit?.dispose(), [kit]);
  // the detour roads' stretches on the map: detour traffic by pressure band
  const detour = useMemo(
    () => (marathon && accessData ? detourLines(marathon, parseLayer(accessData).edges) : []),
    [marathon, accessData],
  );
  const junctions = useMemo(
    () =>
      marathon && accessData
        ? boundaryJunctions(new Set(marathon.course.segment_ids), parseLayer(accessData).edges)
        : [],
    [marathon, accessData],
  );

  useEffect(() => {
    if (!engine || !overlay || !frame || !marathon) return;
    const getT = () => useMarathonPlay.getState().t;
    const cam = createCinematicCamera(marathon, frame);
    const runners = createMarathonRunners(marathon, frame, getT, { tags });
    const detach = overlay.attach(runners);
    // 3D people (crowd kit): runners jog the course, spectators cheer beside it
    const path = localPath(
      marathon.animation.course_coordinates.map((c) => frame.toLocal(c[0] ?? 0, c[1] ?? 0)),
    );
    const crowd = kit
      ? createMarathonCrowd(
          kit,
          path,
          junctions.map((j) => frame.toLocal(j[0], j[1])),
        )
      : null;
    // 3D cars (the city's vehicles kit) for the rerouted sample trips
    const cars = roleUniforms
      ? createMarathonCars(marathon, frame, { lib, manifest, roleUniforms }, detour)
      : null;
    const camAt = new THREE.Vector3();
    let offFrame: (() => void) | null = null;
    if (crowd || cars) {
      const group = new THREE.Group();
      group.name = "marathon-3d";
      if (crowd) group.add(crowd.group);
      if (cars) group.add(cars.mesh);
      engine.setDecor("marathon-3d", {
        group,
        dispose: () => {
          crowd?.dispose();
          cars?.dispose();
        },
      });
      runners.setDotsVisible({ runners: !crowd, cars: !cars });
      const tick = () => {
        const t = getT();
        const p = cam?.(t);
        if (p) camAt.set(...p.pos);
        crowd?.update(t, camAt);
        cars?.update(t);
      };
      tick();
      offFrame = engine.onFrame(tick);
    }

    const driver: CameraDriver | null = cam
      ? () => {
          const p = cam(getT());
          return {
            position: p.pos,
            look: p.look,
            fovDeg: VFOV_DEG,
            animating: useMarathonPlay.getState().playing,
          };
        }
      : null;
    if (driver) engine.setCameraDriver?.(driver);
    // a frame per playback tick (the engine renders on request)
    const unsub = useMarathonPlay.subscribe(() => engine.requestRender());
    engine.requestRender();
    return () => {
      unsub();
      offFrame?.();
      if (crowd || cars) engine.setDecor("marathon-3d", null); // disposes them
      if (driver) engine.releaseCameraDriver?.(driver);
      detach();
      engine.requestRender();
    };
  }, [engine, overlay, frame, marathon, tags, kit, junctions, detour, lib, manifest, roleUniforms]);
}

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { BuildingsLayer } from "../../lib/api";
import { useMarathonPlay } from "../closures/marathonPlayStore";
import { useDevsim } from "../devsim/devsimStore";
import { PoiTag } from "../journey/compare/PoiTag";
import { useCompare } from "../journey/compareStore";
import { journeyHero, useJourney } from "../journey/journeyStore";
import { createHeroLayer } from "../journey/three/heroLayer";
import { createJourneyLayer } from "../journey/three/journeyLayer";
import { projectToScreen } from "../journey/three/project";
import { useScene } from "../scene/sceneStore";
import { poseToCamera } from "../scene/three/cameraRig";
import { preloadHeroModel } from "../scene/three/characters/glbHero";
import type { CameraDriver, Engine } from "../scene/three/engine";
import { releaseSlots } from "../scene/three/engineSlots";
import type { LocalFrame } from "../scene/three/frame";
import type { Boundary } from "../scene/three/ground/boundary";
import {
  blendPose,
  type CamPose,
  type FollowScene,
  journeyCameraAt,
  trackMemoFor,
} from "../scene/three/journey/followRig";
import { heroPositionAt } from "../scene/three/journey/heroDriver";
import { FloodStoryOverlay } from "./FloodStoryOverlay";
import { createBuildingBands, floodBuildingHits } from "./floodBuildings";
import { floodShapes } from "./floodPresentation";
import { installFloodStoryHook } from "./floodStoryHook";
import { useFloodStory } from "./floodStoryStore";
import { BUILDINGS_AT, floodStateAt } from "./floodTimeline";

const smooth = (v: number) => {
  const k = Math.max(0, Math.min(1, v));
  return k * k * (3 - 2 * k);
};
const pose = (
  point: [number, number],
  rangeM: number,
  headingDeg: number,
  pitchDeg = -42,
): CamPose => {
  const p = poseToCamera({ target: point, rangeM, headingDeg, pitchDeg });
  return { pos: p.position, look: p.target };
};
const SLOT = "flood-cinematic-bands";
const HERO_SLOT = "flood-cinematic-resident";

/** Reuses the journey's ribbon, wheelchair hero and follow rig in the existing single engine. */
export function FloodStoryScene({
  engine,
  frame,
  buildings,
  boundary,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  buildings: BuildingsLayer | null | undefined;
  boundary: Boundary | null;
}) {
  useEffect(() => (engine ? installFloodStoryHook(engine) : undefined), [engine]);
  useEffect(() => {
    useFloodStory.setState({ rendererReady: !!engine });
    return () => useFloodStory.setState({ rendererReady: false });
  }, [engine]);
  const story = useFloodStory((s) => s.story);
  const timeline = useFloodStory((s) => s.timeline);
  const stageIndex = useFloodStory((s) => (s.timeline ? floodStateAt(s.t, s.timeline).stage : 0));
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const hits = useMemo(
    () =>
      story && frame
        ? story.stages.map((s) =>
            floodBuildingHits(buildings?.buildings, floodShapes(s.water, frame, boundary), frame),
          )
        : [],
    [story, frame, buildings, boundary],
  );
  const reached = hits[stageIndex] ?? [];
  const focus = hits[3]?.[0] ?? null;
  const currentFocus = reached[0] ?? null;
  const phase = useFloodStory((s) => (s.timeline ? floodStateAt(s.t, s.timeline).phase : null));

  useEffect(() => {
    if (!engine || !story) return;
    const bands = createBuildingBands(reached);
    engine.setDecor(SLOT, bands);
    return () => engine.setDecor(SLOT, null);
  }, [engine, story, reached]);

  useEffect(() => {
    if (!engine || !frame || !story || !timeline) return;
    const centre: [number, number] = focus?.centre ?? [0, 0];
    const riverOverview = pose(centre, 1250, -22, -47);
    const buildingClose = pose(centre, Math.max(180, (focus?.height ?? 9) * 4), -15, -36);
    const trip = story.resident;
    const ribbon = trip ? createJourneyLayer(trip.plan, frame) : null;
    const hero =
      ribbon && trip
        ? createHeroLayer(trip.plan, ribbon.path, frame, {
            footprints: buildings?.buildings,
            grid: engine.clearance?.(),
            roots: () => engine.pickView().roots,
            groundGeneration: () => engine.groundGeneration ?? 0,
            prepare: (o) => engine.prewarm?.(o) ?? Promise.resolve(),
            onPose: (p) => {
              journeyHero.current = p;
            },
          })
        : null;
    if (ribbon) {
      ribbon.ribbon.visible = false;
      ribbon.markers.visible = false;
      engine.setJourney(ribbon);
    }
    if (hero) {
      hero.group.visible = false;
      engine.setDecor(HERO_SLOT, { group: hero.group, dispose: hero.dispose });
    }
    if (trip) void preloadHeroModel(trip.plan.profile);
    let memo = trackMemoFor(null, []);
    let clearance = engine.clearance?.() ?? null;
    const follow: FollowScene | null =
      ribbon && timeline.journey
        ? {
            timeline: timeline.journey,
            pointAt: ribbon.path.pointAt,
            overview: buildingClose,
            pullBackTo: riverOverview,
            clearance,
            seatOf: (i) => hero?.seats.get(i) ?? null,
            markerOf: ribbon.anchorOf,
            heroAt: hero ? (t) => heroPositionAt(timeline.journey!, t, hero.helpers) : undefined,
            track: memo,
          }
        : null;
    const driver: CameraDriver = () => {
      const s = useFloodStory.getState();
      const p = floodStateAt(s.t, timeline);
      const resident = p.phase === "resident";
      if (ribbon) {
        ribbon.ribbon.visible = resident;
        ribbon.markers.visible = resident;
      }
      if (hero && timeline.journey) {
        hero.group.visible = resident;
        if (resident) {
          hero.refreshGround();
          hero.pose(timeline.journey, p.journeyT);
        } else journeyHero.current = null;
      }
      let camera: CamPose;
      if (resident && follow) {
        const nextClearance = engine.clearance?.() ?? null;
        if (nextClearance !== clearance) {
          clearance = nextClearance;
          memo = trackMemoFor(memo, [clearance]);
          follow.clearance = clearance;
          follow.track = memo;
        }
        camera = journeyCameraAt(follow, p.journeyT, "follow") ?? riverOverview;
      } else if (p.phase === "end") camera = riverOverview;
      else if (p.phase === "buildings")
        camera = blendPose(
          pose(centre, 1250, -10, -47),
          buildingClose,
          smooth((s.t - BUILDINGS_AT) / 4),
        );
      else camera = pose(centre, 1250, -22 + 12 * smooth(s.t / BUILDINGS_AT), -47);
      return {
        position: camera.pos,
        look: camera.look,
        fovDeg: 34,
        viewOffset: [0, 0],
        animating: s.playing,
      };
    };
    engine.setCameraDriver?.(driver);
    const unsub = useFloodStory.subscribe(() => engine.requestRender());
    engine.requestRender();
    return () => {
      unsub();
      releaseSlots(engine, { driver });
      if (hero) engine.setDecor(HERO_SLOT, null);
      if (ribbon) engine.setJourney(null);
      journeyHero.current = null;
      engine.requestRender();
    };
  }, [engine, frame, story, timeline, focus, buildings]);

  useEffect(() => {
    if (!engine || !currentFocus) {
      setAnchor(null);
      return;
    }
    let previous = "";
    const off = engine.onFrame(() => {
      const view = engine.pickView();
      const p = projectToScreen(
        view.camera,
        [currentFocus.centre[0], Math.min(currentFocus.height, 40) + 3, currentFocus.centre[1]],
        view.size,
      );
      const visible =
        p && p.x > 150 && p.x < view.size[0] - 150 && p.y > 240 && p.y < view.size[1] - 180
          ? { x: Math.round(p.x), y: Math.round(p.y) }
          : null;
      const key = visible ? `${visible.x},${visible.y}` : "-";
      if (key !== previous) {
        previous = key;
        setAnchor(visible);
      }
    });
    engine.requestRender();
    return off;
  }, [engine, currentFocus]);

  // Another requested scene owns the camera. Close this story before its layers install.
  useEffect(() => {
    const close = () => useFloodStory.getState().close();
    const offJourney = useJourney.subscribe((s, p) => {
      if (s.plan && s.plan !== p.plan) close();
    });
    const offCompare = useCompare.subscribe((s, p) => {
      if (s.payload && s.payload !== p.payload) close();
    });
    const offDevsim = useDevsim.subscribe((s, p) => {
      if (s.status !== "idle" && p.status === "idle") close();
    });
    const offMarathon = useMarathonPlay.subscribe((s, p) => {
      if (s.result && s.result !== p.result) close();
    });
    const offScene = useScene.subscribe((s, p) => {
      if (s.scenarioId !== p.scenarioId || (p.lensVisible.flood && !s.lensVisible.flood)) close();
    });
    return () => {
      offJourney();
      offCompare();
      offDevsim();
      offMarathon();
      offScene();
    };
  }, []);
  // Switching renderer or leaving the page releases the playback and its requests.
  useEffect(() => () => useFloodStory.getState().close(), []);
  const showTag = !!story && (phase === "river" || phase === "buildings") && anchor && currentFocus;
  return (
    <>
      <FloodStoryOverlay />
      {showTag && (
        <div className="pointer-events-none absolute inset-0 z-20">
          <PoiTag
            beat="flood-building"
            at={anchor}
            copy={{
              key: "Building",
              text: `In indicative flood area · River +${story.stages[stageIndex]!.scenario.stage_m} m`,
              note: "OSM footprint · indicative river area",
              tone: "info",
            }}
          />
        </div>
      )}
    </>
  );
}

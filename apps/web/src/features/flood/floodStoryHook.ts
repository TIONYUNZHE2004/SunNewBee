import type { Engine } from "../scene/three/engine";
import { acceptanceEnabled } from "../scene/three/scene/acceptanceFlag";
import { beginFloodStory, useFloodStory } from "./floodStoryStore";
import { floodStateAt } from "./floodTimeline";

/** Seekable acceptance seam, following the journey hook; never a separate playback engine. */
export function installFloodStoryHook(engine: Engine) {
  if (!acceptanceEnabled(import.meta.env.DEV, location.search)) return () => {};
  const root = window as unknown as { __flood?: unknown };
  const hook = {
    start: () => beginFloodStory(false),
    seek: (t: number) => useFloodStory.getState().seek(t),
    play: () => useFloodStory.getState().play(),
    pause: () => useFloodStory.getState().pause(),
    close: () => useFloodStory.getState().close(),
    state: () => {
      const s = useFloodStory.getState();
      const p = s.timeline ? floodStateAt(s.t, s.timeline) : null;
      return {
        status: s.status,
        error: s.error,
        t: s.t,
        total: s.timeline?.total,
        playing: s.playing,
        ...p,
        scenario: s.story && p ? s.story.stages[p.stage]?.scenario.id : null,
        resident: s.story?.resident
          ? {
              origin: s.story.resident.origin.name,
              centre: s.story.resident.centre.centre.name,
              status: s.story.resident.route.status,
              source: s.story.resident.centre.centre.source,
            }
          : null,
        residentGap: s.story?.residentGap,
      };
    },
    camera: () => {
      const v = engine.pickView();
      return { position: v.camera.position.toArray(), size: v.size };
    },
  };
  root.__flood = hook;
  return () => {
    if (root.__flood === hook) delete root.__flood;
  };
}

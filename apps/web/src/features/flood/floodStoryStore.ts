import { create } from "zustand";
import { useScene } from "../scene/sceneStore";
import { type FloodStory, loadFloodStory } from "./floodStoryData";
import { type FloodTimeline, floodStateAt, floodTimeline } from "./floodTimeline";

interface FloodStore {
  rendererReady: boolean;
  status: "idle" | "loading" | "ready" | "error";
  story: FloodStory | null;
  timeline: FloodTimeline | null;
  error: string | null;
  t: number;
  playing: boolean;
  load(story: FloodStory): void;
  play(): void;
  pause(): void;
  seek(t: number): void;
  advance(dt: number): void;
  close(): void;
}
let request: AbortController | null = null;
export const useFloodStory = create<FloodStore>((set, get) => ({
  rendererReady: false,
  status: "idle",
  story: null,
  timeline: null,
  error: null,
  t: 0,
  playing: false,
  load: (story) => {
    useScene.getState().setAmbientTraffic(false);
    set({
      status: "ready",
      story,
      timeline: floodTimeline(story),
      error: null,
      t: 0,
      playing: false,
    });
  },
  play: () => {
    const s = get();
    if (s.timeline) set({ playing: true, t: s.t >= s.timeline.total ? 0 : s.t });
  },
  pause: () => set({ playing: false }),
  seek: (t) => {
    const s = get();
    if (s.timeline) set({ t: floodStateAt(t, s.timeline).seconds });
  },
  advance: (dt) => {
    const s = get();
    if (!s.playing || !s.timeline || !Number.isFinite(dt) || dt < 0) return;
    const t = Math.min(s.timeline.total, s.t + dt);
    set({ t, playing: t < s.timeline.total });
  },
  close: () => {
    request?.abort();
    request = null;
    useScene.getState().setAmbientTraffic(true);
    set({ status: "idle", story: null, timeline: null, error: null, t: 0, playing: false });
  },
}));

export async function beginFloodStory(autoplay = true) {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  useFloodStory.setState({
    status: "loading",
    error: null,
    story: null,
    timeline: null,
    t: 0,
    playing: false,
  });
  try {
    const story = await loadFloodStory(controller.signal);
    if (controller.signal.aborted || request !== controller) return;
    useFloodStory.getState().load(story);
    if (autoplay) useFloodStory.getState().play();
  } catch (error) {
    if (controller.signal.aborted || request !== controller) return;
    useFloodStory.setState({
      status: "error",
      error: error instanceof Error ? error.message : "River story unavailable.",
    });
  }
}

/** Stable renderer seam: no React update or geometry rebuild on a ripple/height frame. */
export function floodWaterFrame(): [number, number, number] {
  const s = useFloodStory.getState();
  if (!s.timeline) return [0, 0, 1];
  const p = floodStateAt(s.t, s.timeline);
  return [p.seconds, p.rise, p.fade];
}

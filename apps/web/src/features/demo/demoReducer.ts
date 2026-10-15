export interface DemoState {
  index: number;
  playing: boolean;
}

export type DemoAction =
  | { type: "next" }
  | { type: "back" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" };

export const initialDemoState: DemoState = { index: 0, playing: false };

/** Step cursor over `total` steps. Never leaves [0, total - 1]; stops playing at the last step. */
export function demoReducer(total: number, s: DemoState, a: DemoAction): DemoState {
  const last = Math.max(0, total - 1);
  switch (a.type) {
    case "next": {
      const index = Math.min(s.index + 1, last);
      return { index, playing: index >= last ? false : s.playing };
    }
    case "back":
      return { index: Math.max(s.index - 1, 0), playing: s.playing };
    case "play":
      return s.index >= last ? s : { ...s, playing: true };
    case "pause":
      return { ...s, playing: false };
    case "toggle":
      return demoReducer(total, s, { type: s.playing ? "pause" : "play" });
  }
}

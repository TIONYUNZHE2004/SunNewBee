import { describe, expect, it } from "vitest";
import { demoReducer, initialDemoState } from "./demoReducer";

const r = demoReducer.bind(null, 3);

describe("demoReducer", () => {
  it("next advances and stops at the last step", () => {
    let s = initialDemoState;
    s = r(s, { type: "next" });
    s = r(s, { type: "next" });
    expect(s.index).toBe(2);
    expect(r(s, { type: "next" }).index).toBe(2);
  });
  it("back goes back and stops at the first step", () => {
    expect(r({ index: 1, playing: false, waiting: false }, { type: "back" }).index).toBe(0);
    expect(r(initialDemoState, { type: "back" }).index).toBe(0);
  });
  it("starts paused and toggles play/pause", () => {
    expect(initialDemoState.playing).toBe(false);
    const p = r(initialDemoState, { type: "toggle" });
    expect(p.playing).toBe(true);
    expect(r(p, { type: "toggle" }).playing).toBe(false);
  });
  it("stops playing when it reaches the last step, and will not play from it", () => {
    const end = r({ index: 1, playing: true, waiting: false }, { type: "next" });
    expect(end).toEqual({ index: 2, playing: false, waiting: false });
    expect(r(end, { type: "play" }).playing).toBe(false);
  });
  it("blocks next, back and nothing else while waiting for an answer", () => {
    const w = r({ index: 1, playing: true, waiting: false }, { type: "waiting", on: true });
    expect(w.waiting).toBe(true);
    expect(r(w, { type: "next" })).toBe(w);
    expect(r(w, { type: "back" })).toBe(w);
    const done = r(w, { type: "waiting", on: false });
    expect(r(done, { type: "next" }).index).toBe(2);
  });
  it("handles an empty script", () => {
    expect(demoReducer(0, initialDemoState, { type: "next" }).index).toBe(0);
  });
});

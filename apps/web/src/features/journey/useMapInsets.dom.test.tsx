// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMapInsets } from "./useMapInsets";

const rect = (x: number, y: number, w: number, h: number) =>
  ({ left: x, top: y, x, y, width: w, height: h, right: x + w, bottom: y + h }) as DOMRect;

const observed: Element[] = [];
class FakeRO {
  observe = (el: Element) => observed.push(el);
  unobserve = (el: Element) => observed.splice(observed.indexOf(el), 1);
  disconnect = () => {
    observed.length = 0;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  observed.length = 0;
  document.body.innerHTML = "";
});

describe("useMapInsets", () => {
  it("observes the mini-map when it mounts and avoids its rectangle", () => {
    vi.stubGlobal("ResizeObserver", FakeRO);
    const host = document.createElement("div");
    host.getBoundingClientRect = () => rect(0, 0, 1200, 800);
    document.body.append(host);
    const { result } = renderHook(() => useMapInsets({ current: host }, true, () => [1, 1]));
    expect(result.current.viewport.avoid).toEqual([]);
    const mini = document.createElement("figure");
    mini.dataset.testid = "journey-minimap";
    mini.getBoundingClientRect = () => rect(960, 16, 224, 170);
    host.append(mini);
    act(() => result.current.miniMapRef(mini));
    expect(observed).toContain(mini);
    expect(result.current.viewport.avoid).toEqual([{ x: 960, y: 16, w: 224, h: 170 }]);
  });

  it("re-measures after a transition ends (the side panel slides in)", () => {
    vi.stubGlobal("ResizeObserver", FakeRO);
    const host = document.createElement("div");
    host.getBoundingClientRect = () => rect(0, 0, 1200, 800);
    document.body.append(host);
    const { result } = renderHook(() => useMapInsets({ current: host }, true, () => [1, 1]));
    expect(result.current.viewport.w).toBe(1200);
    host.style.setProperty("--panel-w", "380px");
    act(() => {
      document.body.dispatchEvent(new Event("transitionend", { bubbles: true }));
    });
    expect(result.current.viewport.w).toBe(820);
  });
});

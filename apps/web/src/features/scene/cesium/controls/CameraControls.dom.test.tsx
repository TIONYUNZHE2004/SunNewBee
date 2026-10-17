// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePanel } from "../../../main/panelStore";
import { CameraControls, handleMapKey } from "./CameraControls";
import { useCameraHeading } from "./cameraHeadingStore";
import { STEP } from "./cameraMath";
import type { CameraOps } from "./cameraOps";
import { useCameraUi } from "./cameraUiStore";

const ops = (): CameraOps => ({
  orbit: vi.fn(),
  move: vi.fn(),
  zoom: vi.fn(),
  glideTo: vi.fn(),
  faceNorth: vi.fn(),
  home: vi.fn(),
  whole: vi.fn(),
  headingRad: () => 0,
});

describe("CameraControls", () => {
  beforeEach(() => {
    localStorage.clear();
    useCameraUi.setState({ alwaysShow: false, hintDismissed: false });
  });

  it("shows only the compass until the corner is hovered or focused", () => {
    render(<CameraControls ops={ops()} />);
    expect(screen.getByRole("button", { name: "Face north (N)" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Zoom in/ })).toBeNull();
    fireEvent.mouseEnter(screen.getByRole("group", { name: "Camera" }));
    expect(screen.getByRole("button", { name: "Zoom in (+)" })).toBeInTheDocument();
  });

  it("the camera cluster sits above the phone sheet and the attribution strip", () => {
    render(<CameraControls ops={ops()} />);
    expect(screen.getByRole("group", { name: "Camera" }).className).toContain(
      "bottom-[calc(var(--sheet-h,0px)+var(--attr-h,0px)+1rem)]",
    );
  });

  it("buttons call the camera actions", () => {
    const o = ops();
    useCameraUi.setState({ alwaysShow: true });
    render(<CameraControls ops={o} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in (+)" }));
    expect(o.zoom).toHaveBeenCalledWith(STEP.zoomIn);
    fireEvent.click(screen.getByRole("button", { name: "Rotate left (Q)" }));
    expect(o.orbit).toHaveBeenCalledWith(-STEP.orbitRad, 0);
    fireEvent.click(screen.getByRole("button", { name: "Tilt up (R)" }));
    expect(o.orbit).toHaveBeenCalledWith(0, STEP.tiltRad);
    fireEvent.click(screen.getByRole("button", { name: "Home view" }));
    expect(o.home).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Whole township" }));
    expect(o.whole).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Face north (N)" }));
    expect(o.faceNorth).toHaveBeenCalled();
  });

  it("the compass follows the heading store", () => {
    useCameraHeading.setState({ heading: 0 });
    render(<CameraControls ops={ops()} />);
    const needle = () =>
      screen
        .getByRole("button", { name: "Face north (N)" })
        .querySelector("span span") as HTMLElement;
    expect(needle().style.transform).toBe("rotate(0rad)");
    act(() => useCameraHeading.setState({ heading: 1.5 }));
    expect(needle().style.transform).toBe("rotate(-1.5rad)");
  });

  it("first-visit hint can be dismissed and stays dismissed", () => {
    render(<CameraControls ops={ops()} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss camera tips" }));
    expect(screen.queryByText(/Drag to move/)).toBeNull();
    expect(localStorage.getItem("tl.camera.hint")).toBe("dismissed");
  });

  it("map keys act; keys from a text field never do", () => {
    const o = ops();
    const ev = (key: string, target: Element) =>
      ({
        key,
        target,
        preventDefault: vi.fn(),
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }) as never;
    const div = document.createElement("div");
    handleMapKey(ev("w", div), o);
    expect(o.move).toHaveBeenCalledWith(0, 1);
    const input = document.createElement("input");
    handleMapKey(ev("w", input), o);
    expect(o.move).toHaveBeenCalledTimes(1);
  });

  describe("keyboard through React's event path", () => {
    const setup = () => {
      const o = ops();
      render(
        <div>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: mirrors the real map section */}
          <section tabIndex={0} aria-label="map" onKeyDown={(e) => handleMapKey(e, o)}>
            <button type="button">inside</button>
          </section>
          <input aria-label="chat" />
        </div>,
      );
      const acted = () =>
        (o.move as ReturnType<typeof vi.fn>).mock.calls.length +
        (o.orbit as ReturnType<typeof vi.fn>).mock.calls.length +
        (o.zoom as ReturnType<typeof vi.fn>).mock.calls.length;
      return { o, acted };
    };
    const KEYS = ["w", "a", "+", "ArrowUp"];

    it("typing in a sibling text field never acts", () => {
      const { acted } = setup();
      const input = screen.getByLabelText("chat");
      for (const key of KEYS) fireEvent.keyDown(input, { key });
      expect(acted()).toBe(0);
    });

    it("the same keys on the focused map act", () => {
      const { acted } = setup();
      const map = screen.getByLabelText("map");
      for (const key of KEYS) fireEvent.keyDown(map, { key });
      expect(acted()).toBe(KEYS.length);
    });

    it("a key from a button inside the map acts", () => {
      const { o } = setup();
      fireEvent.keyDown(screen.getByRole("button", { name: "inside" }), { key: "w" });
      expect(o.move).toHaveBeenCalledWith(0, 1);
    });

    it("Ctrl, Meta and Alt combos never act", () => {
      const { acted } = setup();
      const map = screen.getByLabelText("map");
      fireEvent.keyDown(map, { key: "w", ctrlKey: true });
      fireEvent.keyDown(map, { key: "w", metaKey: true });
      fireEvent.keyDown(map, { key: "w", altKey: true });
      expect(acted()).toBe(0);
    });
  });
});

describe("CameraControls behind the full phone sheet", () => {
  const media = (wide: boolean) =>
    vi.stubGlobal("matchMedia", () => ({
      matches: wide,
      addEventListener() {},
      removeEventListener() {},
    }));
  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => usePanel.setState({ sheet: "peek" }));
  });
  const group = () => screen.getByRole("group", { name: "Camera" });

  it("hides the camera group on a narrow screen with the sheet at full", () => {
    media(false);
    usePanel.setState({ sheet: "full" });
    render(<CameraControls ops={ops()} />);
    expect(group().className.split(" ")).toContain("invisible");
  });
  it("keeps it visible on a narrow screen at half, and on a wide screen at full", () => {
    media(false);
    usePanel.setState({ sheet: "half" });
    const { unmount } = render(<CameraControls ops={ops()} />);
    expect(group().className.split(" ")).not.toContain("invisible");
    unmount();
    media(true);
    usePanel.setState({ sheet: "full" });
    render(<CameraControls ops={ops()} />);
    expect(group().className.split(" ")).not.toContain("invisible");
  });
  it("follows a rotation (matchMedia change) and a sheet change after the first render", () => {
    let matches = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }));
    const rotate = (wide: boolean) => {
      matches = wide;
      act(() => {
        for (const l of listeners) l();
      });
    };
    usePanel.setState({ sheet: "full" });
    render(<CameraControls ops={ops()} />);
    const invisible = () => group().className.split(" ").includes("invisible");
    expect(invisible()).toBe(false); // wide: the sheet is not shown
    rotate(false);
    expect(invisible()).toBe(true); // narrow + full
    act(() => usePanel.setState({ sheet: "half" }));
    expect(invisible()).toBe(false);
    act(() => usePanel.setState({ sheet: "full" }));
    expect(invisible()).toBe(true);
    rotate(true);
    expect(invisible()).toBe(false);
  });
});

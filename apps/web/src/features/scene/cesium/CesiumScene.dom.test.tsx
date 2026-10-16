// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithClient } from "../../../test/helpers";

const seen: { contextOptions: unknown }[] = [];
let mounts = 0;
vi.mock("resium", () => ({
  Viewer: (props: { contextOptions: unknown }) => {
    seen.push({ contextOptions: props.contextOptions });
    useEffect(() => {
      mounts++;
    }, []);
    return null;
  },
  useCesium: () => ({ viewer: undefined }),
}));

describe("CesiumScene", () => {
  it("passes read-only Viewer props by stable reference so resium never recreates the viewer", async () => {
    const { default: CesiumScene } = await import("./CesiumScene");
    const r = renderWithClient(<CesiumScene />);
    r.rerender(
      <QueryClientProvider client={r.qc}>
        <CesiumScene />
      </QueryClientProvider>,
    );
    await act(async () => {});
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0]?.contextOptions).toEqual({ webgl: { alpha: true } });
    for (const s of seen) expect(s.contextOptions).toBe(seen[0]?.contextOptions);
    expect(mounts).toBe(1);
  }, 60_000);

  it("a camera move updates the compass heading without re-rendering the Viewer subtree", async () => {
    const { default: CesiumScene } = await import("./CesiumScene");
    const { trackHeading, useCameraHeading } = await import("./controls/cameraHeadingStore");
    renderWithClient(<CesiumScene />);
    // Let the API queries settle (each settles with one re-render) before measuring.
    for (let i = 0; i < 5; i++) await act(() => new Promise((r) => setTimeout(r, 20)));
    const before = seen.length;
    let fire = () => {};
    const camera = {
      heading: 0,
      percentageChanged: 0.5,
      changed: {
        addEventListener: (cb: () => void) => {
          fire = cb;
          return () => {};
        },
      },
    };
    trackHeading(camera);
    expect(camera.percentageChanged).toBe(0.01);
    camera.heading = 1.25;
    await act(async () => fire());
    expect(useCameraHeading.getState().heading).toBe(1.25);
    expect(seen.length).toBe(before);
  }, 60_000);
});

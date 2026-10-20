import { describe, expect, it } from "vitest";
import { createGpuPacer } from "./gpuPacer";

/** A fake WebGL2 fence API: fences signal when `gpuDone` reaches their index. */
function fakeGl() {
  let n = 0;
  const st = { gpuDone: 0, deleted: 0, flushed: 0 };
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    SYNC_STATUS: 2,
    SIGNALED: 3,
    fenceSync: () => ({ id: ++n }) as unknown as WebGLSync,
    getSyncParameter: (s: WebGLSync) => ((s as unknown as { id: number }).id <= st.gpuDone ? 3 : 4),
    deleteSync: () => {
      st.deleted++;
    },
    flush: () => {
      st.flushed++;
    },
  };
  return { gl, st };
}

describe("GPU frame pacing (ITER2 AC-D18: no command-buffer pile-up behind a GPU-heavy dive)", () => {
  it("renders at most two frames ahead of the GPU, then waits without blocking", () => {
    const { gl, st } = fakeGl();
    const p = createGpuPacer(gl as never);
    expect(p.ready(0)).toBe(true);
    p.submitted(0);
    expect(p.ready(10)).toBe(true);
    p.submitted(10);
    // each fence is flushed to the GPU at once (an idle loop must not wait on an unsent fence)
    expect(st.flushed).toBe(2);
    // two frames in flight, the GPU has finished neither
    expect(p.ready(20)).toBe(false);
    expect(p.ready(30)).toBe(false);
    st.gpuDone = 1;
    expect(p.ready(40)).toBe(true);
    expect(st.deleted).toBe(1);
    expect(p.stats.skipped).toBe(2);
    expect(p.stats.longestWaitMs).toBe(20);
  });

  it("a render on demand after an idle spell never waits; a wait never exceeds 100 ms", () => {
    const { gl } = fakeGl();
    const p = createGpuPacer(gl as never);
    p.submitted(0);
    p.submitted(10);
    expect(p.ready(20)).toBe(false);
    // 50 ms after the last rendered frame (a seek, a toggle): renders
    expect(p.ready(60)).toBe(true);
    p.submitted(60);
    p.submitted(70);
    expect(p.ready(75)).toBe(false);
    expect(p.ready(110)).toBe(false);
    expect(p.ready(175)).toBe(true);
  });

  it("a fence that never signals (lost context) is dropped after the give-up time", () => {
    const { gl } = fakeGl();
    const p = createGpuPacer(gl as never, { giveUpMs: 1000 });
    p.submitted(0);
    p.submitted(5);
    expect(p.ready(10)).toBe(false);
    expect(p.ready(1001)).toBe(true);
  });

  it("without fences (WebGL1, test stubs) every frame renders", () => {
    const p = createGpuPacer({} as never);
    p.submitted(0);
    p.submitted(1);
    p.submitted(2);
    expect(p.ready(3)).toBe(true);
    expect(createGpuPacer(null).ready(0)).toBe(true);
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const boot = async () => {
  vi.resetModules();
  const preset = await import("./preset");
  return {
    preset,
    settings: (await import("../scene/sceneSettingsStore")).useSceneSettings,
    scene: (await import("../scene/sceneStore")).useScene,
    theme: (await import("../../ui/theme")).useTheme,
    panel: (await import("../main/panelStore")).usePanel,
    sun: await import("../scene/three/sunClock"),
  };
};

describe("demo preset", () => {
  beforeEach(() => localStorage.clear());

  it("parses only demo=1", async () => {
    const { preset } = await boot();
    expect(preset.isDemoPreset("?demo=1")).toBe(true);
    expect(preset.isDemoPreset("?a=b&demo=1")).toBe(true);
    for (const s of ["", "?demo=0", "?demo=true", "?demo=", "?acceptance=1"])
      expect(preset.isDemoPreset(s)).toBe(false);
  });

  it("AC-A16: with tl.quality=low stored, ?demo=1 gives High and storage still says low", async () => {
    localStorage.setItem("tl.quality", "low");
    localStorage.setItem("tl.pathStatus", "true");
    localStorage.setItem("tl.theme", "night");
    localStorage.setItem("tl.panel.open", "false");
    const { preset, settings, scene, theme, panel } = await boot();
    expect(settings.getState().quality).toBe("low");
    expect(preset.applyDemoPreset("?demo=1")).toBe(true);
    expect(settings.getState().quality).toBe("high");
    expect(settings.getState().pathStatus).toBe(false);
    expect(scene.getState().mapStyle).toBe("stylised");
    expect(scene.getState().mapStyleChosen).toBe(true);
    expect(theme.getState().theme).toBe("day");
    expect(document.documentElement.dataset.theme).toBe("day");
    expect(panel.getState().open).toBe(true);
    expect(localStorage.getItem("tl.quality")).toBe("low");
    expect(localStorage.getItem("tl.pathStatus")).toBe("true");
    expect(localStorage.getItem("tl.theme")).toBe("night");
    expect(localStorage.getItem("tl.panel.open")).toBe("false");
  });

  it("B-T4: ?demo=1 pins the sun clock to 10:30 MYT on the fixed date; a normal load keeps the real clock", async () => {
    const a = await boot();
    expect(a.preset.applyDemoPreset("")).toBe(false);
    expect(a.sun.sunClockPinned()).toBe(false);
    const real = new Date("2026-10-19T12:00:00Z");
    expect(a.sun.sunNow(real)).toBe(real);
    const b = await boot();
    expect(b.preset.applyDemoPreset("?demo=1")).toBe(true);
    expect(b.sun.sunNow(real).toISOString()).toBe(new Date(b.sun.PINNED_SUN_ISO).toISOString());
  });

  it("without the flag the user's choice is kept", async () => {
    localStorage.setItem("tl.quality", "low");
    const { preset, settings } = await boot();
    expect(preset.applyDemoPreset("")).toBe(false);
    expect(settings.getState().quality).toBe("low");
  });
});

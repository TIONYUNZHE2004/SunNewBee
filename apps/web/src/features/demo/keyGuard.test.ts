import { describe, expect, it } from "vitest";
import { type KeyLike, shouldHandleKey } from "./keyGuard";

const ev = (key: string, target: object | null, over: Partial<KeyLike> = {}): KeyLike => ({
  key,
  defaultPrevented: false,
  target: target as EventTarget | null,
  ...over,
});
const el = (tagName: string, extra: object = {}) => ({ tagName, ...extra });

describe("shouldHandleKey", () => {
  it("handles keys from the page body", () => {
    for (const k of ["ArrowRight", "ArrowLeft", " ", "Escape"])
      expect(shouldHandleKey(ev(k, el("BODY")))).toBe(true);
  });
  it("ignores input, textarea, select and contenteditable (including Esc)", () => {
    for (const t of [
      el("INPUT"),
      el("TEXTAREA"),
      el("SELECT"),
      el("DIV", { isContentEditable: true }),
    ])
      for (const k of ["ArrowRight", " ", "Escape"]) expect(shouldHandleKey(ev(k, t))).toBe(false);
  });
  it("ignores a tab button and anything inside a tablist", () => {
    const tab = el("BUTTON", { closest: (s: string) => (s.includes('[role="tab"]') ? {} : null) });
    expect(shouldHandleKey(ev("ArrowRight", tab))).toBe(false);
    expect(shouldHandleKey(ev("Escape", tab))).toBe(false);
  });
  it("leaves Space to a focused button but still takes arrows", () => {
    const b = el("BUTTON", { closest: () => null });
    expect(shouldHandleKey(ev(" ", b))).toBe(false);
    expect(shouldHandleKey(ev("ArrowRight", b))).toBe(true);
  });
  it("honours defaultPrevented and modifier keys", () => {
    expect(shouldHandleKey(ev("ArrowRight", el("BODY"), { defaultPrevented: true }))).toBe(false);
    expect(shouldHandleKey(ev("ArrowRight", el("BODY"), { metaKey: true }))).toBe(false);
  });
});

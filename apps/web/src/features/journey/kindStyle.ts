import type { JourneyEventKind } from "./timeline";

/** Event-kind colours (prototype palette): cards, mini-map dots and 3D markers. */
export const KIND_COLOUR: Readonly<Record<JourneyEventKind, string>> = {
  verified: "#2fa97c",
  unknown: "#e8931f",
  rest: "#4f7fd1",
  gap: "#c0566b",
  covered: "#5fa8a0",
  arrive: "#e8644f",
};

/** Marker glyphs (drawn on the 3D marker texture). */
export const KIND_GLYPH: Readonly<Record<JourneyEventKind, string>> = {
  verified: "✓",
  unknown: "?",
  rest: "Ⅱ",
  gap: "!",
  covered: "☂",
  arrive: "★",
};

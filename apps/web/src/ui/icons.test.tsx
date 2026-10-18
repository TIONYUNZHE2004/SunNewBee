import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icon, type IconName } from "./icons";

const ALL: IconName[] = [
  "walk",
  "stroller",
  "wheelchair",
  "older",
  "car",
  "flood",
  "recycle",
  "pin",
  "route",
  "check",
  "ticket",
  "compass",
  "chevron",
  "send",
  "camera",
  "close",
  "map",
  "chat",
];

describe("Icon", () => {
  it.each(ALL)("%s is decorative SVG", (n) => {
    const html = renderToStaticMarkup(<Icon name={n} />);
    expect(html).toMatch(/^<svg/);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('stroke="currentColor"');
  });
});

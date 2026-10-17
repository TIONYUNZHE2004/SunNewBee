// @ts-expect-error web tsconfig has no @types/node; vitest runs in node so the module exists
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };
const css: string = readFileSync(`${process.cwd()}/src/index.css`, "utf8");

describe("no-scrollbar utility", () => {
  it("hides the scrollbar in Firefox and WebKit/Blink but keeps the element scrollable", () => {
    const start = css.indexOf("@utility no-scrollbar");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = css.slice(start, css.indexOf("\n}", start));
    expect(body).toMatch(/scrollbar-width:\s*none/);
    expect(body).toMatch(/&::-webkit-scrollbar\s*\{\s*display:\s*none/);
    expect(body).not.toMatch(/overflow\s*:\s*hidden/);
  });
});

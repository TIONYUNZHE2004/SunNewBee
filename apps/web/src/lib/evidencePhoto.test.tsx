import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidencePhoto } from "./EvidencePhoto";
import { MAX_PHOTO_BYTES, photoAlt, photoSrc, validatePhoto } from "./evidence";

const file = (type: string, size: number) => ({ type, size }) as File;

describe("validatePhoto", () => {
  it("is optional", () => expect(validatePhoto(null)).toBeNull());
  it("accepts JPEG and PNG up to 5 MB", () => {
    expect(validatePhoto(file("image/jpeg", 1000))).toBeNull();
    expect(validatePhoto(file("image/png", MAX_PHOTO_BYTES))).toBeNull();
  });
  it("rejects other types in plain words", () =>
    expect(validatePhoto(file("image/gif", 10))).toMatch(/JPEG or PNG/));
  it("rejects files over 5 MB with the size", () =>
    expect(validatePhoto(file("image/jpeg", MAX_PHOTO_BYTES + 1))).toMatch(/5 MB/));
  it("rejects an empty file", () => expect(validatePhoto(file("image/png", 0))).toMatch(/empty/));
});

describe("photoSrc", () => {
  it("routes API evidence paths through /api", () =>
    expect(photoSrc("/evidence/ab12")).toBe("/api/evidence/ab12"));
  it("ignores anything else", () => {
    expect(photoSrc("https://evil.example/x.png")).toBeNull();
    expect(photoSrc("//evil.example/x")).toBeNull();
    expect(photoSrc(null)).toBeNull();
    expect(photoSrc("/evidence/../token")).toBeNull();
  });
});

describe("photoAlt", () => {
  it("names element and attribute", () =>
    expect(photoAlt("Mall", "step_count")).toBe("Photo evidence for Mall · Step count"));
});

describe("EvidencePhoto", () => {
  const props = { photoUrl: "/evidence/ab12", element: "Mall", attribute: "step_count" };
  it("renders a lazy thumbnail linking to the full image in a new tab", () => {
    const h = renderToStaticMarkup(
      <EvidencePhoto {...props} source="site_visit" checked="2026-01-02" />,
    );
    expect(h).toContain('src="/api/evidence/ab12"');
    expect(h).toContain('alt="Photo evidence for Mall · Step count"');
    expect(h).toContain('loading="lazy"');
    expect(h).toContain('target="_blank"');
    expect(h).toContain('rel="noopener noreferrer"');
    expect(h).toContain("opens the full image in a new tab");
    expect(h).toContain("site_visit");
    expect(h).toContain("checked 2026-01-02");
    expect(h).not.toContain("token");
  });
  it("renders nothing without a usable photo", () => {
    expect(renderToStaticMarkup(<EvidencePhoto {...props} photoUrl={null} />)).toBe("");
  });
});

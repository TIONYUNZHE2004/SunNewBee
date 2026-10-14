import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreateVrButtonView } from "./CreateVrButton";
import { createVrError, createVrMessage } from "./createVr";
import { ApiError } from "./manageApi";

const res = (created: boolean, demand: number) => ({
  request_id: "r",
  element_id: "e",
  attribute: "a",
  created,
  demand,
  type: "verification.requested" as const,
});

describe("createVrMessage", () => {
  it("new request", () => expect(createVrMessage(res(true, 1))).toBe("Request filed (demand 1)"));
  it("duplicate", () =>
    expect(createVrMessage(res(false, 3))).toBe("Already requested; demand is now 3"));
});

describe("createVrError", () => {
  it("auth", () => {
    expect(createVrError(new ApiError(401))).toBe("Staff token required or not configured");
    expect(createVrError(new ApiError(503))).toBe("Staff token required or not configured");
  });
  it("generic", () => expect(createVrError(new Error("x"))).toMatch(/could not be filed/));
});

describe("CreateVrButtonView", () => {
  const base = { label: "seg-1 incline_pct", onClick: () => {} };
  it("idle: enabled button with accessible name", () => {
    const h = renderToStaticMarkup(<CreateVrButtonView {...base} status="idle" />);
    expect(h).toContain("Create verification request");
    expect(h).toContain("seg-1 incline_pct");
    expect(h).not.toContain('disabled=""');
  });
  it("no token: disabled with a reason", () => {
    const h = renderToStaticMarkup(<CreateVrButtonView {...base} status="idle" noToken />);
    expect(h).toContain('disabled=""');
    expect(h).toContain("Enter the staff token");
  });
  it("pending: disabled", () => {
    const h = renderToStaticMarkup(<CreateVrButtonView {...base} status="pending" />);
    expect(h).toContain("Filing…");
    expect(h).toContain('disabled=""');
  });
  it("success and error messages are announced", () => {
    const ok = renderToStaticMarkup(
      <CreateVrButtonView {...base} status="done" message="Request filed (demand 1)" />,
    );
    expect(ok).toContain('role="status"');
    expect(ok).toContain("Request filed (demand 1)");
    const bad = renderToStaticMarkup(
      <CreateVrButtonView {...base} status="error" message="nope" />,
    );
    expect(bad).toContain('role="alert"');
    expect(bad).toContain("nope");
  });
});

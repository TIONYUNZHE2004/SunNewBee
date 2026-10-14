import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CreateVrButtonView } from "./CreateVrButton";
import {
  createVrError,
  createVrMessage,
  PhotoUploadError,
  submitResolution,
  uploadErrorMessage,
} from "./createVr";
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

describe("submitResolution", () => {
  const body = { action: "correct" as const, value: 3, note: "n" };
  const jpg = { type: "image/jpeg", size: 10 } as File;
  it("uploads first, then resolves with the evidence id", async () => {
    const calls: string[] = [];
    await submitResolution(
      {
        upload: async () => {
          calls.push("upload");
          return { evidence_id: "e1", photo_url: "/evidence/e1" };
        },
        resolve: async (b) => void calls.push(`resolve:${b.evidence_id}`),
      },
      jpg,
      body,
    );
    expect(calls).toEqual(["upload", "resolve:e1"]);
  });
  it("skips the upload without a photo", async () => {
    const resolve = vi.fn(async () => {});
    const upload = vi.fn();
    await submitResolution({ upload, resolve }, null, body);
    expect(upload).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith(body);
  });
  it("does not resolve when the upload fails", async () => {
    const resolve = vi.fn(async () => {});
    const err = new ApiError(422, "Not a JPEG or PNG image");
    await expect(
      submitResolution({ upload: async () => Promise.reject(err), resolve }, jpg, body),
    ).rejects.toMatchObject({ cause: err });
    expect(resolve).not.toHaveBeenCalled();
  });
  it("marks upload failures so they read as photo problems", async () => {
    const e = await submitResolution(
      { upload: async () => Promise.reject(new ApiError(422, "bad")), resolve: async () => {} },
      jpg,
      body,
    ).catch((x) => x);
    expect(e).toBeInstanceOf(PhotoUploadError);
  });
});

describe("uploadErrorMessage", () => {
  it("shows the API message in plain words", () =>
    expect(uploadErrorMessage(new ApiError(422, "Only JPEG or PNG images are accepted"))).toBe(
      "The photo could not be uploaded: Only JPEG or PNG images are accepted. The request was not resolved.",
    ));
  it("handles auth, size and unknown failures", () => {
    expect(uploadErrorMessage(new ApiError(401))).toMatch(/Staff token/);
    expect(uploadErrorMessage(new ApiError(413))).toMatch(/5 MB/);
    expect(uploadErrorMessage(new Error("x"))).toMatch(/could not be uploaded/);
  });
});

// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import type { VR } from "../tickets/manageApi";
import { ResolveForm } from "./VerificationQueue";

const vr = (current_value: unknown): VR => ({
  id: "vr-1",
  element_id: "seg-cf",
  attribute: "incline_pct",
  reason: "unknown",
  status: "open",
  demand: 1,
  created_at: "2026-10-15T00:00:00Z",
  current_value,
});
const png = () => new File([new Uint8Array([1, 2, 3])], "ramp.png", { type: "image/png" });

const setup = (v: VR = vr(3)) => {
  const onDone = vi.fn();
  const utils = renderWithClient(<ResolveForm vr={v} token="tok" onDone={onDone} />);
  return { onDone, user: userEvent.setup(), ...utils };
};
const photoInput = () => screen.getByLabelText(/Photo evidence/);
const action = () => screen.getByLabelText("Action");

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("ResolveForm photo and action", () => {
  it("choosing Reject hides the photo input and explains why", async () => {
    const { user } = setup();
    expect(photoInput()).toBeInTheDocument();
    await user.selectOptions(action(), "reject");
    expect(screen.queryByLabelText(/Photo evidence/)).not.toBeInTheDocument();
    expect(screen.getByText("Photos are only attached to Verify or Correct")).toBeInTheDocument();
  });

  it("a photo chosen before Reject is dropped: switching back and submitting uploads nothing", async () => {
    const fetchMock = stubFetch(() => json({}));
    const { user } = setup();
    await user.upload(photoInput(), png());
    await user.selectOptions(action(), "reject");
    await user.selectOptions(action(), "verify");
    // The input is a fresh, empty one.
    expect((photoInput() as HTMLInputElement).files).toHaveLength(0);
    await user.type(screen.getByLabelText("Note"), "checked on site");
    await user.click(screen.getByRole("button", { name: "Submit resolution" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/verification-requests/vr-1/resolve");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ action: "verify", note: "checked on site" });
  });

  it("rejecting after choosing a photo resolves without uploading it", async () => {
    const fetchMock = stubFetch(() => json({}));
    const { user, onDone } = setup();
    await user.upload(photoInput(), png());
    await user.selectOptions(action(), "reject");
    await user.type(screen.getByLabelText("Note"), "not an issue");
    await user.click(screen.getByRole("button", { name: "Submit resolution" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      "/api/verification-requests/vr-1/resolve",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      action: "reject",
      note: "not an issue",
    });
  });

  it("Verify is disabled, with a reason, when the claim has no current value", () => {
    setup(vr(null));
    expect(screen.getByRole("option", { name: /Verify/ })).toBeDisabled();
    expect(screen.getByText(/Nothing to verify yet/)).toBeInTheDocument();
    expect(action()).toHaveValue("correct");
  });

  it("Verify is selectable when there is a current value", () => {
    setup(vr(3));
    expect(screen.getByRole("option", { name: /Verify/ })).toBeEnabled();
    expect(action()).toHaveValue("verify");
    expect(screen.queryByText(/Nothing to verify yet/)).not.toBeInTheDocument();
  });
});

describe("ResolveForm submit", () => {
  it("uploads the photo first, then resolves with the evidence id, then closes", async () => {
    const fetchMock = stubFetch((url) =>
      url === "/api/evidence" ? json({ evidence_id: "ev-9" }) : json({}),
    );
    const { user, onDone } = setup();
    await user.upload(photoInput(), png());
    await user.type(screen.getByLabelText("Note"), "ramp measured");
    await user.click(screen.getByRole("button", { name: "Submit resolution" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(["/api/evidence", "/api/verification-requests/vr-1/resolve"]);
    const upload = fetchMock.mock.calls[0]?.[1];
    const form = upload?.body;
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get("file")).toBeInstanceOf(File);
    expect(new Headers(upload?.headers).get("X-Staff-Token")).toBe("tok");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      action: "verify",
      note: "ramp measured",
      evidence_id: "ev-9",
    });
  });

  it("an upload failure shows a readable message and never resolves", async () => {
    const fetchMock = stubFetch((url) =>
      url === "/api/evidence" ? json({ detail: "too big" }, 413) : json({}),
    );
    const { user, onDone } = setup();
    await user.upload(photoInput(), png());
    await user.type(screen.getByLabelText("Note"), "ramp measured");
    await user.click(screen.getByRole("button", { name: "Submit resolution" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The photo is over the 5 MB limit.");
    expect(alert).toHaveTextContent("The request was not resolved.");
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/evidence"]);
    expect(onDone).not.toHaveBeenCalled();
    // The form is usable again for a retry.
    expect(screen.getByRole("button", { name: "Submit resolution" })).toBeEnabled();
  });

  it("a missing note blocks the request before any fetch", async () => {
    const fetchMock = stubFetch(() => json({}));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Submit resolution" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A note is required.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

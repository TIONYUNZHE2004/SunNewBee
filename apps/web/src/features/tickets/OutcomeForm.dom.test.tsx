// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import { OutcomeForm } from "./OutcomeForm";
import type { Ticket } from "./ticketModel";
import { useStaffTokenStore } from "./useStaffToken";

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: "vr-1",
  attribute: "opening_hours",
  fact: "Opening hours",
  place: "Cafe",
  reason: "unknown",
  reasonLabel: "Unknown",
  kind: "Stroller route from A to B",
  asked: 1,
  ago: "just now",
  current: "9-5",
  hasCurrent: true,
  isOpen: true,
  isRejected: false,
  isChecked: false,
  resolution: null,
  createdMs: 0,
  resolvedMs: 0,
  ...over,
});
const png = (size = 3) => new File([new Uint8Array(size)], "r.png", { type: "image/png" });

const setup = (t: Ticket = ticket()) => {
  const onSaved = vi.fn();
  const utils = renderWithClient(<OutcomeForm ticket={t} onSaved={onSaved} />);
  return { onSaved, user: userEvent.setup(), ...utils };
};
const choose = (user: ReturnType<typeof userEvent.setup>, name: RegExp) =>
  user.click(screen.getByRole("radio", { name }));
const save = () => screen.getByRole("button", { name: "Save result" });
const body = (fm: ReturnType<typeof stubFetch>, i = 0) =>
  JSON.parse(String(fm.mock.calls[i]?.[1]?.body));

beforeEach(() => {
  vi.unstubAllGlobals();
  useStaffTokenStore.setState({ token: "tok" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OutcomeForm", () => {
  it("offers Confirm only when a value is recorded", () => {
    const { unmount } = setup();
    expect(screen.getByRole("group", { name: "What did you find on site?" })).toBeInTheDocument();
    for (const n of [/Confirm/, /Correct/, /Reject/])
      expect(screen.getByRole("radio", { name: n })).toBeInTheDocument();
    unmount();
    setup(ticket({ hasCurrent: false, current: null }));
    expect(screen.getByRole("radio", { name: /Record what you found/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Reject/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Confirm/ })).not.toBeInTheDocument();
  });

  it("outcomes are native radios Tab and Space can pick", async () => {
    const { user } = setup();
    const group = screen.getByRole("group", { name: "What did you find on site?" });
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    await user.tab();
    await user.keyboard(" ");
    expect(screen.getByRole("radio", { name: /Confirm/ })).toBeChecked();
  });

  it("the chosen card shows a check glyph and a 2 px accent border", async () => {
    const { user } = setup();
    const card = (name: RegExp) =>
      screen.getByRole("radio", { name }).closest("label") as HTMLElement;
    expect(card(/Reject/).querySelector('[data-testid="choice-check"]')).toBeNull();
    await user.click(screen.getByRole("radio", { name: /Reject/ }));
    const chosen = card(/Reject/);
    const check = chosen.querySelector('[data-testid="choice-check"]');
    expect(check).not.toBeNull();
    expect(check?.closest("[aria-hidden='true']")).not.toBeNull();
    expect(chosen.className).toContain("has-[:checked]:border-2");
    expect(card(/Confirm/).querySelector('[data-testid="choice-check"]')).toBeNull();
  });

  it("disables Save until an outcome (and a value for Correct) is chosen", async () => {
    const { user } = setup();
    expect(save()).toBeDisabled();
    await choose(user, /Correct/);
    expect(save()).toBeDisabled();
    await user.type(screen.getByLabelText("Value found on site"), "10-6");
    expect(save()).toBeEnabled();
  });

  it("Confirm posts verify with the staff token then calls onSaved", async () => {
    const fm = stubFetch(() => json({}));
    const { user, onSaved } = setup();
    await choose(user, /Confirm/);
    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(String(fm.mock.calls[0]?.[0])).toBe("/api/verification-requests/vr-1/resolve");
    expect(new Headers(fm.mock.calls[0]?.[1]?.headers).get("X-Staff-Token")).toBe("tok");
    expect(body(fm)).toEqual({ action: "verify", note: "Checked on site" });
  });

  it("Correct posts text values", async () => {
    const fm = stubFetch(() => json({}));
    const { user, onSaved } = setup(ticket({ attribute: "name" }));
    await choose(user, /Correct/);
    await user.type(screen.getByLabelText("Value found on site"), "0 steps");
    await user.type(screen.getByLabelText("Note (optional)"), "measured");
    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body(fm)).toEqual({ action: "correct", value: "0 steps", note: "measured" });
  });

  it("Correct posts a number for a number attribute", async () => {
    const fm = stubFetch(() => json({}));
    const { user, onSaved } = setup(ticket({ attribute: "step_count" }));
    await choose(user, /Correct/);
    await user.type(screen.getByLabelText("Value found on site"), "2");
    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body(fm)).toEqual({ action: "correct", value: 2, note: "Checked on site" });
  });

  it("number attributes get a numeric hint, and typing 0 enables Save and posts a number", async () => {
    const fm = stubFetch(() => json({}));
    const { user, onSaved } = setup(ticket({ attribute: "step_count" }));
    await choose(user, /Correct/);
    const input = screen.getByLabelText("Value found on site");
    expect(input).toHaveAttribute("placeholder", "e.g. 0");
    expect(save()).toBeDisabled();
    await user.type(input, "0");
    expect(save()).toBeEnabled();
    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body(fm)).toEqual({ action: "correct", value: 0, note: "Checked on site" });
  });

  it("text attributes keep text hints", async () => {
    const { user } = setup(ticket({ attribute: "name" }));
    await choose(user, /Correct/);
    expect(screen.getByLabelText("Value found on site").getAttribute("placeholder")).toMatch(
      /^e\.g\. [A-Za-z]/,
    );
  });

  it("an enum attribute's Correct select posts the chosen option", async () => {
    const fm = stubFetch(() => json({}));
    const { user, onSaved } = setup(ticket({ attribute: "wheelchair" }));
    await choose(user, /Correct/);
    expect(save()).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Value found on site"), "yes");
    expect(save()).toBeEnabled();
    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body(fm)).toEqual({ action: "correct", value: "yes", note: "Checked on site" });
  });

  it("uploads a photo first and sends evidence_id; Reject drops it", async () => {
    const fm = stubFetch((u) => (u === "/api/evidence" ? json({ evidence_id: "ev-9" }) : json({})));
    const { user, onSaved, unmount } = setup();
    await choose(user, /Confirm/);
    await user.upload(screen.getByLabelText("Add photo"), png());
    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fm.mock.calls.map((c) => String(c[0]))).toEqual([
      "/api/evidence",
      "/api/verification-requests/vr-1/resolve",
    ]);
    expect(body(fm, 1).evidence_id).toBe("ev-9");
    unmount();

    const fm2 = stubFetch(() => json({}));
    const s2 = setup();
    await choose(s2.user, /Confirm/);
    await s2.user.upload(screen.getByLabelText("Add photo"), png());
    await choose(s2.user, /Reject/);
    await s2.user.click(save());
    await waitFor(() => expect(s2.onSaved).toHaveBeenCalled());
    expect(fm2.mock.calls.map((c) => String(c[0]))).toEqual([
      "/api/verification-requests/vr-1/resolve",
    ]);
    expect(body(fm2)).toEqual({ action: "reject", note: "Checked on site" });
  });

  it("without a token asks for staff access and disables Save", async () => {
    useStaffTokenStore.setState({ token: "" });
    const { user } = setup();
    expect(screen.getByLabelText("Staff access")).toBeInTheDocument();
    await choose(user, /Confirm/);
    expect(save()).toBeDisabled();
    await user.type(screen.getByLabelText("Staff access"), "tok");
    expect(save()).toBeEnabled();
  });

  it.each([401, 403, 503])("a %i keeps the form and asks for staff access", async (status) => {
    stubFetch(() => json({ detail: "x" }, status));
    const { user, onSaved } = setup();
    await choose(user, /Correct/);
    await user.type(screen.getByLabelText("Value found on site"), "10-6");
    await user.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Staff access needed");
    expect(screen.getByLabelText("Value found on site")).toHaveValue("10-6");
    expect(screen.getByRole("radio", { name: /Correct/ })).toBeChecked();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a 409 says someone else resolved it and refetches", async () => {
    stubFetch(() => json({ detail: "x" }, 409));
    const { user, onSaved, qc } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await choose(user, /Confirm/);
    await user.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Someone else already resolved this ticket.",
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ["tickets"] });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a photo over 5 MB shows the message and never uploads", async () => {
    const fm = stubFetch(() => json({}));
    const { user } = setup();
    await choose(user, /Confirm/);
    await user.upload(screen.getByLabelText("Add photo"), png(6 * 1024 * 1024));
    expect(screen.getByText(/the limit is 5 MB/)).toBeInTheDocument();
    await user.click(save());
    expect(fm.mock.calls.filter((c) => String(c[0]) === "/api/evidence")).toHaveLength(0);
  });

  it("renders when sessionStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setup();
    expect(screen.getByRole("group", { name: "What did you find on site?" })).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, renderWithClient, stubFetch } from "../../test/helpers";
import { ClosureForm, ClosureList } from "./Closures";
import type { Closure } from "./closureModel";

const row = (over: Partial<Closure> = {}): Closure =>
  ({
    id: "cl-0001",
    element_id: "seg-ab",
    element_name: "Lakeside path",
    element_kind: "edge",
    reason: "works",
    starts_at: "2026-10-15T00:00:00Z",
    ends_at: "2999-10-20T00:00:00Z",
    note: null,
    label: "Closed: works until 2999-10-20",
    source_label: "Reported closure (staff)",
    active: true,
    ...over,
  }) as Closure;

const tokenOf = (init?: RequestInit): string | undefined =>
  (init?.headers as Record<string, string> | undefined)?.["X-Staff-Token"];

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("ClosureForm", () => {
  it("posts the closure with the staff token and clears the form", async () => {
    const fetchMock = stubFetch(() => json(row(), 201));
    const user = userEvent.setup();
    renderWithClient(<ClosureForm token="tok" />);
    await user.type(screen.getByLabelText("Element id"), "seg-ab");
    await user.selectOptions(screen.getByLabelText("Reason"), "event");
    await user.type(screen.getByLabelText(/Note/), "Fun run");
    await user.click(screen.getByRole("button", { name: "Report closure" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Closure reported"));
    const call = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/closures");
    expect(call?.[1]?.method).toBe("POST");
    expect(tokenOf(call?.[1])).toBe("tok");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      element_id: "seg-ab",
      reason: "event",
      note: "Fun run",
    });
    expect(screen.getByLabelText("Element id")).toHaveValue("");
  });

  it("fills the element id from a place search", async () => {
    stubFetch((url) =>
      url.startsWith("/api/places?q=")
        ? json({ ok: true, data: [{ id: "toilet-1", name: "Park toilet" }] })
        : json({}),
    );
    const user = userEvent.setup();
    renderWithClient(<ClosureForm token="tok" />);
    await user.type(screen.getByLabelText("Search places"), "toilet");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: /Park toilet/ }));
    expect(screen.getByLabelText("Element id")).toHaveValue("toilet-1");
    expect(screen.getByText("Selected: Park toilet")).toBeInTheDocument();
  });

  it("refuses an end before the start without calling the API", async () => {
    const fetchMock = stubFetch(() => json({}));
    const user = userEvent.setup();
    renderWithClient(<ClosureForm token="tok" />);
    await user.type(screen.getByLabelText("Element id"), "seg-ab");
    await user.type(screen.getByLabelText("Starts"), "2026-10-17T08:00");
    await user.type(screen.getByLabelText("Ends"), "2026-10-16T08:00");
    await user.click(screen.getByRole("button", { name: "Report closure" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("End must be after the start");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is disabled without a staff token, and shows a 401 as a token problem", async () => {
    const { unmount } = renderWithClient(<ClosureForm token="" />);
    expect(screen.getByRole("button", { name: "Report closure" })).toBeDisabled();
    unmount();
    stubFetch(() => json({ detail: "staff token required" }, 401));
    const user = userEvent.setup();
    renderWithClient(<ClosureForm token="bad" />);
    await user.type(screen.getByLabelText("Element id"), "seg-ab");
    await user.click(screen.getByRole("button", { name: "Report closure" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Staff token required");
  });

  it("shows the server's 422 detail", async () => {
    stubFetch(() => json({ detail: "ends_at must be after starts_at" }, 422));
    const user = userEvent.setup();
    renderWithClient(<ClosureForm token="tok" />);
    await user.type(screen.getByLabelText("Element id"), "seg-ab");
    await user.click(screen.getByRole("button", { name: "Report closure" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ends_at must be after starts_at");
  });
});

describe("ClosureList", () => {
  it("labels each row as a staff report with its dates", () => {
    renderWithClient(<ClosureList items={[row({ note: "Resurfacing" })]} token="tok" />);
    const li = screen.getByRole("listitem");
    expect(within(li).getAllByText(/Lakeside path/).length).toBeGreaterThan(0);
    expect(within(li).getByText("Closed: works until 2999-10-20")).toBeInTheDocument();
    expect(
      within(li).getByText(/Reported closure \(staff\)\. From 2026-10-15 to 2999-10-20/),
    ).toBeInTheDocument();
    expect(within(li).getByText("Note: Resurfacing")).toBeInTheDocument();
    expect(li.textContent?.toLowerCase()).not.toContain("safe");
  });

  it("End now posts to /closures/{id}/end with the token", async () => {
    const fetchMock = stubFetch(() => json(row({ active: false })));
    const user = userEvent.setup();
    renderWithClient(<ClosureList items={[row()]} token="tok" />);
    await user.click(screen.getByRole("button", { name: /End now/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("/api/closures/cl-0001/end");
    expect(init?.method).toBe("POST");
    expect(tokenOf(init)).toBe("tok");
  });

  it("has no End button for an ended closure and says so when empty", () => {
    const { unmount } = renderWithClient(
      <ClosureList items={[row({ active: false, ends_at: "2020-01-01T00:00:00Z" })]} token="tok" />,
    );
    expect(screen.queryByRole("button", { name: /End now/ })).not.toBeInTheDocument();
    expect(screen.getByText("Ended")).toBeInTheDocument();
    unmount();
    renderWithClient(<ClosureList items={[]} token="tok" />);
    expect(screen.getByText("No closures reported.")).toBeInTheDocument();
  });

  it("a 409 tells staff it has already ended", async () => {
    stubFetch(() => json({ detail: "cl-0001 has already ended" }, 409));
    const user = userEvent.setup();
    renderWithClient(<ClosureList items={[row()]} token="tok" />);
    await user.click(screen.getByRole("button", { name: /End now/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already ended");
  });
});

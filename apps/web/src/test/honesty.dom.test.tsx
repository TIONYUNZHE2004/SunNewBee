// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useMode } from "../app/modeStore";
import { MainPage } from "../features/main/MainPage";
import { useScene } from "../features/scene/sceneStore";
import { TicketsPage } from "../features/tickets/TicketsPage";
import { useStaffTokenStore } from "../features/tickets/useStaffToken";
import { type Theme, useTheme } from "../ui/theme";
import { json, newQueryClient, renderWithClient, stubFetch } from "./helpers";

const BANNED = /\bsafe\b|selamat|安全/i;
const DEPTH = /\b\d+(\.\d+)?\s?(m|cm|metres?)\b[^.]{0,20}\b(deep|depth)/i;

const scenarios = [
  { id: "baseline", label: "Baseline", stage_m: 0, disclaimer: "d", links: [] },
  {
    id: "stage_p3m",
    label: "River +3 m",
    stage_m: 3,
    method: "REM",
    dem: "Copernicus GLO-30",
    margin_m: 0.5,
    created: "2026-09-30",
    disclaimer: "Indicative scenario, not a forecast.",
    links: [],
  },
];
const floodLayer = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: null,
      properties: { id: "e1", name: "Jalan Tasik", flood_class: "likely_flooded" },
    },
  ],
};
const placeData = (extra: Record<string, unknown>) => ({
  ok: true,
  data: { id: "p1", name: "Dewan Komuniti", type: "community_hall", claims: {}, ...extra },
});
const sse = (events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });

// The typed API client rejects relative URLs under jsdom, so seed the query cache instead.
function main(opts: { scene?: () => void; place?: unknown } = {}) {
  const qc = newQueryClient();
  qc.setQueryData(["scenarios"], scenarios);
  qc.setQueryData(["site"], { id: "t", name: "Test", attribution: [] });
  qc.setQueryData(["layer", "flood", useScene.getState().profile, "stage_p3m"], floodLayer);
  if (opts.place) qc.setQueryData(["place", "p1", null, null], opts.place);
  opts.scene?.();
  return renderWithClient(<MainPage />, qc);
}

/** Every control a person can operate must have a name a screen reader can announce. */
function expectAccessibleNames() {
  for (const el of [
    ...screen.queryAllByRole("button"),
    ...screen.queryAllByRole("radio"),
    ...screen.queryAllByRole("link"),
    ...screen.queryAllByRole("textbox"),
    ...screen.queryAllByRole("combobox"),
    ...document.querySelectorAll("input"),
  ])
    expect(el, el.outerHTML.slice(0, 120)).toHaveAccessibleName();
}

const body = () => document.body.textContent ?? "";

describe.each<Theme>(["day", "night"])("honesty and accessibility (%s theme)", (theme) => {
  beforeEach(() => {
    useTheme.getState().setTheme(theme);
    useScene.getState().reset();
    useMode.setState({ mode: "resident" });
    useStaffTokenStore.setState({ token: "tok" });
    stubFetch(() => json([]));
  });
  afterEach(() => cleanup());

  it("applies the theme", () => {
    expect(document.documentElement.dataset.theme).toBe(theme);
  });

  it("main screen at +3 m: not a forecast, no safety words, no depths, named controls", async () => {
    main();
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    await userEvent.click(screen.getByRole("radio", { name: "+3 m" }));
    expect(await screen.findByRole("note")).toHaveTextContent(/not a forecast/i);
    expect(body()).not.toMatch(BANNED);
    expect(body()).not.toMatch(DEPTH);
    expectAccessibleNames();
  });

  it("management mode keeps the same wording rules", async () => {
    useMode.setState({ mode: "management" });
    main();
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    await userEvent.click(screen.getByRole("radio", { name: "+3 m" }));
    expect(await screen.findByRole("note")).toHaveTextContent(/not a forecast/i);
    expect(body()).not.toMatch(BANNED);
    expect(body()).not.toMatch(DEPTH);
    expectAccessibleNames();
  });

  it("an assistant flood answer carries the disclaimer and no safety claim", async () => {
    stubFetch((url) =>
      url.includes("/chat")
        ? sse([
            {
              type: "text.delta",
              delta: "At the River +3 m scenario, Jalan Tasik is likely flooded.",
            },
            {
              type: "disclaimer",
              lens: "flood",
              text: "Indicative scenario, not a forecast.",
              links: [],
            },
            { type: "done", message_id: "m", answer_status: "answered", model: "mock" },
          ])
        : json([]),
    );
    main();
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "flood");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    const card = await screen.findByRole("article");
    expect(card).toHaveTextContent(/not a forecast/i);
    expect(body()).not.toMatch(BANNED);
    expect(body()).not.toMatch(DEPTH);
    expectAccessibleNames();
  });

  it("path card: explains the path with no safety claim and no depth", () => {
    main({
      scene: () => {
        useScene.setState({ scenarioId: "stage_p3m" });
        useScene.getState().selectFloodEdge("e1");
      },
    });
    const card = screen.getByRole("dialog", { name: "Why this path?" });
    expect(card.textContent).not.toMatch(BANNED);
    expect(card.textContent).not.toMatch(/depth/i);
    expect(card.textContent).not.toMatch(DEPTH);
    expect(card).toHaveTextContent(/not a forecast|indicative/i);
    expectAccessibleNames();
  });

  it("placeholder evidence reads Demo value, never Verified, in that fact row", () => {
    main({
      place: placeData({
        claims: {
          capacity: { value: 300, status: "reported", evidence_type: "team_survey_placeholder" },
          wheelchair: { value: "yes", status: "verified", evidence_type: "staff_site_visit" },
        },
      }),
      scene: () => useScene.getState().selectPlace("p1"),
    });
    const facts = screen.getByRole("list", { name: "Facts" });
    const demo = within(facts).getByText("Demo value · not surveyed").closest("li");
    expect(demo).not.toBeNull();
    expect(demo?.textContent).not.toMatch(/Verified/);
    // A genuinely verified fact still says so, so the check above is not vacuous.
    expect(facts.textContent).toMatch(/Verified/);
    expect(body()).not.toMatch(BANNED);
    expectAccessibleNames();
  });

  it("a data gap reads No mapped connection, never not reachable", () => {
    main({
      place: placeData({
        kind: "evac_centre",
        source: "osm_candidate",
        reachability: { reachable: false, route_status: "no_data", from: "lakeside-mall" },
      }),
      scene: () => useScene.getState().selectPlace("p1"),
    });
    expect(body()).toContain("No mapped connection (data gap)");
    expect(body()).not.toMatch(/not reachable|unreachable/i);
  });

  it("an OSM evacuation centre reads Candidate, never Official", () => {
    main({
      place: placeData({ kind: "evac_centre", source: "osm_candidate" }),
      scene: () => useScene.getState().selectPlace("p1"),
    });
    expect(screen.getAllByText(/Candidate/).length).toBeGreaterThan(0);
    expect(body()).not.toMatch(/Official/);
    expect(body()).not.toMatch(BANNED);
  });

  it("settings popover: every control is a 40px+ target with a name", async () => {
    main();
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    const pop = screen.getByRole("dialog", { name: "Map settings" });
    const controls = [
      ...within(pop).getAllByRole("radio"),
      ...within(pop).queryAllByRole("button"),
      ...within(pop).queryAllByRole("link"),
    ];
    expect(controls.length).toBeGreaterThan(4);
    for (const c of controls) expect(c.className, c.outerHTML.slice(0, 100)).toMatch(/min-h-1[01]/);
    expectAccessibleNames();
  });

  it("tickets screen: named controls, no safety words, no unreachable wording", async () => {
    stubFetch((url) =>
      url.includes("/verification-requests")
        ? json([
            {
              id: "a",
              element_id: "seg-a",
              attribute: "step_count",
              reason: "no_route_unverified_segment",
              status: "open",
              demand: 3,
              question_summary: "Stroller route from A to B",
              created_at: new Date().toISOString(),
              current_value: null,
            },
          ])
        : json({ type: "FeatureCollection", features: [] }),
    );
    const router = createMemoryRouter([{ path: "/tickets", element: <TicketsPage /> }], {
      initialEntries: ["/tickets"],
    });
    renderWithClient(<RouterProvider router={router} />);
    await screen.findByRole("radiogroup", { name: "Outcome" });
    await userEvent.click(screen.getByRole("radio", { name: /Correct|Record/ }));
    expect(body()).not.toMatch(BANNED);
    expect(body()).not.toMatch(/not reachable/i);
    expectAccessibleNames();
  });
});

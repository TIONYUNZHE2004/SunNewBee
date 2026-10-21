// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useMode } from "../app/modeStore";
import { MainPage } from "../features/main/MainPage";
import { usePanel } from "../features/main/panelStore";
import { useScene } from "../features/scene/sceneStore";
import { TicketsPage } from "../features/tickets/TicketsPage";
import { useStaffTokenStore } from "../features/tickets/useStaffToken";
import { type Theme, useTheme } from "../ui/theme";
import mockFloodTurn from "./fixtures/mockFloodTurn.json";
import { json, newQueryClient, renderWithClient, stubFetch } from "./helpers";
import { assertHonest, DEPTH, DEPTH_WORD, honestyViolations } from "./honesty";

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
let qcLayerOverride: unknown = null;
function main(opts: { scene?: () => void; place?: unknown } = {}) {
  const qc = newQueryClient();
  qc.setQueryData(["scenarios"], scenarios);
  qc.setQueryData(["site"], { id: "t", name: "Test", attribution: [] });
  qc.setQueryData(
    ["layer", "flood", useScene.getState().profile, "stage_p3m"],
    qcLayerOverride ?? floodLayer,
  );
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
    // inputs hidden from the accessibility tree (e.g. the paperclip's file input, whose visible
    // control is the named button above) are not operable by a person, so they are skipped
    ...[...document.querySelectorAll("input")].filter(
      (el) => !el.closest('[hidden],[aria-hidden="true"]'),
    ),
  ])
    expect(el, el.outerHTML.slice(0, 120)).toHaveAccessibleName();
}

const body = () => document.body.textContent ?? "";

describe.each<Theme>(["day", "night"])("honesty and accessibility (%s theme)", (theme) => {
  beforeEach(() => {
    usePanel.setState({ open: true });
    useTheme.getState().setChoice(theme);
    useScene.getState().reset();
    useMode.setState({ mode: "resident" });
    useStaffTokenStore.setState({ token: "tok" });
    qcLayerOverride = null;
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
    assertHonest(body());
    expectAccessibleNames();
  });

  it("management mode: its own starters and heading, no Travelling as, same wording rules", async () => {
    useMode.setState({ mode: "management" });
    main();
    expect(screen.getByRole("heading", { name: "Ask about the township" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Ask about getting around" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Map settings" }));
    expect(screen.queryByRole("radiogroup", { name: "Travelling as" })).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "+3 m" }));
    expect(await screen.findByRole("note")).toHaveTextContent(/not a forecast/i);
    assertHonest(body());
    expectAccessibleNames();
  });

  it("a recorded mock flood turn renders not-a-forecast and passes the honesty gate", async () => {
    stubFetch((url) => (url.includes("/chat") ? sse(mockFloodTurn.events) : json([])));
    main();
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "flood");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    const card = await screen.findByRole("article");
    expect(card).toHaveTextContent(/This is not a forecast/);
    expect(card).toHaveTextContent(/indicative scenario/i);
    assertHonest(card.textContent ?? "");
    assertHonest(body());
    expectAccessibleNames();
  });

  it("negative control: a streamed 'it is safe' is caught by the matcher", async () => {
    stubFetch((url) =>
      url.includes("/chat")
        ? sse([
            { type: "text.delta", delta: "Take Jalan Tasik, it is safe." },
            { type: "done", message_id: "m", answer_status: "answered", model: "mock" },
          ])
        : json([]),
    );
    main();
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "flood");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    const card = await screen.findByRole("article");
    expect(card).toHaveTextContent("it is safe");
    expect(() => assertHonest(body())).toThrow(/safety wording/);
  });

  it("path card: no safety claim, no depth, even when the edge carries a depth property", () => {
    qcLayerOverride = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: null,
          properties: {
            id: "e1",
            name: "Jalan Tasik",
            flood_class: "likely_flooded",
            depth_m: 0.73,
            water_depth: "0.73 m",
          },
        },
      ],
    };
    main({
      scene: () => {
        useScene.setState({ scenarioId: "stage_p3m" });
        useScene.getState().selectFloodEdge("e1");
      },
    });
    const card = screen.getByRole("dialog", { name: "Why this path?" });
    assertHonest(card.textContent ?? "");
    expect(card.textContent).not.toMatch(DEPTH_WORD);
    expect(card.textContent).not.toMatch(/0\.73/);
    expect(card).toHaveTextContent(/indicative/i);
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
    const verified = within(facts).getByText("Wheelchair").closest("li");
    expect(verified?.textContent).toMatch(/Verified/);
    assertHonest(body());
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
    assertHonest(body());
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
            {
              id: "b",
              element_id: "seg-b",
              attribute: "width_m",
              reason: "no_route_unverified_segment",
              status: "resolved",
              demand: 2,
              question_summary: "Wheelchair route from C to D",
              created_at: new Date(Date.now() - 86_400_000).toISOString(),
              resolved_at: new Date().toISOString(),
              resolution: { action: "correct", value: "1.2" },
              current_value: 1.2,
            },
          ])
        : json({ type: "FeatureCollection", features: [] }),
    );
    const router = createMemoryRouter([{ path: "/tickets", element: <TicketsPage /> }], {
      initialEntries: ["/tickets"],
    });
    renderWithClient(<RouterProvider router={router} />);
    await screen.findByRole("group", { name: "What did you find on site?" });
    await userEvent.click(screen.getByRole("radio", { name: /Correct|Record/ }));
    assertHonest(body());
    assertHonest(body());
    expect(body()).not.toMatch(/not reachable/i);
    await userEvent.click(screen.getByRole("tab", { name: /Checked/ }));
    expectAccessibleNames();
    // A checked ticket: the Before panel never repeats the post-resolution value.
    await userEvent.click(screen.getByRole("button", { name: /Width \(m\)/ }));
    expect(await screen.findByText("Not checked yet")).toBeInTheDocument();
    assertHonest(body());
    expectAccessibleNames();
  });
});

describe("honesty matchers can fail", () => {
  it.each(["the path is 0.5 m deep", "depth of 2 m", "water depth 30 cm"])(
    "flags depth wording: %s",
    (t) => {
      expect(honestyViolations(t).length).toBeGreaterThan(0);
      expect(() => assertHonest(t)).toThrow(/Honesty violation/);
    },
  );
  it("DEPTH itself matches a measured depth", () => {
    expect(DEPTH.test("0.5 m deep")).toBe(true);
    expect(DEPTH.test("water 30 cm deep here")).toBe(true);
  });
  it.each(["it is safe", "Selamat datang", "这里很安全"])("flags safety wording: %s", (t) => {
    expect(() => assertHonest(t)).toThrow(/safety wording/);
  });
  it.each([
    "Indicative scenario, not a forecast; follow official MBSA / JPS / NADMA guidance.",
    "River +3 m scenario: Jalan Tasik is likely flooded.",
    "Step count 2, width 1.2 m.",
    "Safely ignore this? no: unsafe is a different word",
  ])("accepts clean text: %s", (t) => {
    expect(() => assertHonest(t)).not.toThrow();
  });
});

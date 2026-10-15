// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { newQueryClient, renderWithClient } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { PlaceOverlay } from "./PlaceOverlay";

const place = {
  ok: true,
  data: {
    id: "p1",
    name: "Dewan Komuniti",
    kind: "evac_centre",
    source: "osm_candidate",
    type: "community_hall",
    claims: {
      wheelchair: { value: null, status: "unknown" },
      capacity: { value: 300, status: "reported", evidence_type: "team_survey_placeholder" },
    },
  },
};

function setup(data: unknown = place) {
  const qc = newQueryClient();
  qc.setQueryData(["place", "p1", null, null], data);
  useScene.getState().selectPlace("p1");
  return renderWithClient(<PlaceOverlay />, qc);
}

beforeEach(() => useScene.getState().reset());

describe("PlaceOverlay", () => {
  it("shows the place with honest source and status wording", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Dewan Komuniti" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dewan Komuniti" })).toHaveFocus();
    expect(screen.getAllByText(/Candidate/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Official/)).not.toBeInTheDocument();
    expect(screen.getByText("Demo value · not surveyed")).toBeInTheDocument();
    expect(screen.queryByText(/Verified/)).not.toBeInTheDocument();
    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
  });

  it("shows a Closed banner with the staff source and date for an active closure", () => {
    const LABEL = "Closed: works until 20 Oct 2026";
    setup({
      ok: true,
      data: {
        id: "p1",
        name: "Park toilet",
        type: "toilet",
        claims: {},
        closures: [
          {
            id: "cl-0001",
            element_id: "p1",
            reason: "works",
            starts_at: "2026-10-15T00:00:00Z",
            ends_at: "2026-10-20T00:00:00Z",
            note: null,
            label: LABEL,
            source_label: "Reported closure (staff)",
            active: true,
          },
        ],
      },
    });
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Closed");
    expect(banner).toHaveTextContent(`Reported closure (staff): ${LABEL}`);
    expect(banner).toHaveTextContent("15 Oct 2026");
  });

  it("shows no Closed banner when nothing is closed", () => {
    setup();
    expect(screen.queryByText("Closed")).not.toBeInTheDocument();
  });

  it("has no staff editing", () => {
    setup();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/token/i)).not.toBeInTheDocument();
  });

  it("closes with the button and with Escape", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Close place details" }));
    expect(useScene.getState().selectedPlaceId).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    useScene.getState().selectPlace("p1");
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(useScene.getState().selectedPlaceId).toBeNull();
  });
});

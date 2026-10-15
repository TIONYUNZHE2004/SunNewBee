// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagePage } from "./ManagePage";

vi.mock("./KpiTiles", () => ({ KpiTiles: () => null }));
vi.mock("./VerificationQueue", () => ({ VerificationQueue: () => <p>queue panel</p> }));
vi.mock("./FloodBriefing", () => ({ FloodBriefing: () => <p>briefing panel</p> }));
vi.mock("./JourneyTests", () => ({ JourneyTests: () => <p>journeys panel</p> }));
vi.mock("./Closures", () => ({ Closures: () => <p>closures panel</p> }));

afterEach(cleanup);

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
const at = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ManagePage />
      <Where />
    </MemoryRouter>,
  );

describe("ManagePage deep links", () => {
  it.each([
    ["/manage?tab=queue", "queue panel"],
    ["/manage?tab=briefing", "briefing panel"],
    ["/manage?tab=journeys", "journeys panel"],
    ["/manage?tab=closures", "closures panel"],
    ["/manage?tab=flood", "briefing panel"],
    ["/manage", "queue panel"],
    ["/manage?tab=nonsense", "queue panel"],
  ])("%s opens %s", (url, panel) => {
    at(url);
    expect(screen.getByText(panel)).toBeInTheDocument();
  });

  it("marks the deep-linked tab as selected", () => {
    at("/manage?tab=closures");
    expect(screen.getByRole("tab", { name: "Closures" })).toHaveAttribute("aria-selected", "true");
  });

  it("changing tab updates the URL with replace, so Back is not spammed", async () => {
    const { container } = at("/manage?tab=queue");
    await userEvent.click(screen.getByRole("tab", { name: "Journey tests" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/manage?tab=journeys");
    expect(screen.getByText("journeys panel")).toBeInTheDocument();
    expect(container).toBeTruthy();
  });

  it("arrow keys move between tabs and update the URL", async () => {
    at("/manage?tab=queue");
    screen.getByRole("tab", { name: "Verification queue" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByTestId("where")).toHaveTextContent("/manage?tab=briefing");
  });
});

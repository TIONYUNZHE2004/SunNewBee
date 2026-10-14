import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { useChatDraft } from "../chat/chatDraftStore";
import { ScenarioButtons, shortLabel, WhereCanIGo } from "./ScenarioBar";

describe("ScenarioButtons", () => {
  it("shortens labels and keeps full accessible names", () => {
    expect(shortLabel("River +3 m (indicative)")).toBe("+3 m");
    expect(shortLabel("+2 m of rain, then -1 m of drain")).toBe("+2 m of rain, then -1 m of drain");
    expect(shortLabel("Odd label")).toBe("Odd label");
    const html = renderToStaticMarkup(
      <ScenarioButtons
        scenarios={[{ id: "p1", label: "River +1 m (indicative)" }]}
        scenarioId={null}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain('aria-label="River +1 m (indicative)"');
    expect(html).toContain('aria-label="Normal"');
    expect(html).toMatch(/sm:hidden[^>]*>\+1 m</);
    expect(html).toMatch(/hidden sm:inline[^>]*>River \+1 m \(indicative\)</);
  });
});

describe("WhereCanIGo", () => {
  beforeEach(() => useChatDraft.setState({ pendingAsk: null }));

  it("is absent without a scenario and present with one", () => {
    expect(renderToStaticMarkup(<WhereCanIGo scenarioId={null} onAsk={() => {}} />)).toBe("");
    const html = renderToStaticMarkup(<WhereCanIGo scenarioId="stage_p3m" onAsk={() => {}} />);
    expect(html).toContain("Where can I go?");
  });

  it("sends a message without profile or scenario text", () => {
    const sent: string[] = [];
    // Render the element and invoke its handler directly (node env, no DOM).
    const el = WhereCanIGo({ scenarioId: "stage_p3m", onAsk: (t) => sent.push(t) });
    (el as { props: { onClick: () => void } }).props.onClick();
    expect(sent).toEqual(["Where can I go?"]);
    expect(sent[0]).not.toMatch(/stroller|wheelchair|older|walking|driving|stage_p3m/i);
  });

  it("queues the question for the chat panel", () => {
    useChatDraft.getState().ask("Where can I go?");
    expect(useChatDraft.getState().pendingAsk?.text).toBe("Where can I go?");
  });
});

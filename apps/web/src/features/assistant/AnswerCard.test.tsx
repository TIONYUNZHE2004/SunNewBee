import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { type AssistantMessage, emptyAssistant } from "../chat/chatReducer";
import { AnswerCard } from "./AnswerCard";

vi.mock("../chat/useElementNames", () => ({ useElementNames: () => new Map() }));

const msg = (patch: Partial<AssistantMessage>): AssistantMessage => ({
  ...emptyAssistant("a1"),
  ...patch,
});

describe("AnswerCard drafts and checks", () => {
  it("shows a draft, labelled as not yet checked, before the checked text arrives", () => {
    const html = renderToStaticMarkup(
      <AnswerCard
        m={msg({ draft: "Yes, there is a mapped route", draftAttempt: 1 })}
        onRetry={() => {}}
      />,
    );
    expect(html).toContain("Draft · checking against the township data");
    expect(html).toContain("Yes, there is a mapped route");
    expect(html).not.toContain("Checking the data");
  });

  it("replaces the draft with the checked text and lists the verdicts", () => {
    const html = renderToStaticMarkup(
      <AnswerCard
        m={msg({
          draft: "old draft",
          text: "Route status: confirmed",
          done: true,
          checks: [
            {
              type: "answer.check",
              attempt: 1,
              ok: false,
              issues: ["mentioned a water depth"],
              repairs: 0,
            },
            { type: "answer.check", attempt: 2, ok: true, issues: [], repairs: 0 },
          ],
        })}
        onRetry={() => {}}
      />,
    );
    expect(html).not.toContain("old draft");
    expect(html).toContain("Sent back for a rewrite: mentioned a water depth");
    expect(html).toContain("Answer checked against the township data");
  });

  it("says when the answer was built from the checked data without AI wording", () => {
    const html = renderToStaticMarkup(
      <AnswerCard
        m={msg({ text: "Route of 120 m.", done: true, model: "x/model+template" })}
        onRetry={() => {}}
      />,
    );
    expect(html).toContain("Answer built from the checked data without AI wording");
  });
});

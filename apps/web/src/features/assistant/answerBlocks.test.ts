import { describe, expect, it } from "vitest";
import { answerBlocks, blockWords, statusTone } from "./answerBlocks";

const ROUTE = `Route status: partly unverified
Lakeside Mall Car Park B to Urban Park playground: route partly unverified. There is a mapped walking route of about 416 m.
1. Start heading south-west along the street for about 38 m (not checked yet).
2. Turn left onto the street. Continue about 46 m (not checked yet).
3. … 2 more steps are not listed here (shortened directions).
4. Reach the end of the mapped route.
Worth knowing:
• Some segment facts are demo values, not yet surveyed.
• River +3 m: indicative scenario, not a forecast. Follow official MBSA / JPS / NADMA guidance.`;

const words = (s: string) =>
  s
    .replace(/[().:]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

describe("answerBlocks (the checked answer as display blocks)", () => {
  it("splits status, summary, steps and notes", () => {
    const b = answerBlocks(ROUTE);
    expect(b.map((x) => x.kind)).toEqual(["status", "para", "steps", "notes"]);
    expect(b[0]).toMatchObject({ value: "partly unverified", tone: "warn" });
    const steps = b[2]?.kind === "steps" ? b[2].steps : [];
    expect(steps).toHaveLength(4);
    expect(steps[0]).toEqual({
      text: "Start heading south-west along the street for about 38 m.",
      note: "not checked yet",
    });
    expect(steps[2]?.elided).toBe(true);
    expect(b[3]).toMatchObject({
      title: "Worth knowing",
      items: [expect.any(String), expect.any(String)],
    });
  });

  it("is lossless: every word of the text is in a block, in order", () => {
    const joined = answerBlocks(ROUTE).map(blockWords).join(" ");
    expect(words(joined).filter((w) => w !== "•")).toEqual(
      words(ROUTE.replace(/^\d+\. /gm, "").replace(/•/g, "")),
    );
  });

  it("keeps the honesty wording verbatim", () => {
    const text = answerBlocks(ROUTE).map(blockWords).join(" ");
    expect(text).toContain("Route status: partly unverified");
    expect(text).toContain("demo values, not yet surveyed");
    expect(text).toContain("not a forecast");
  });

  it("a plain answer is one paragraph; a status mid-text is not lifted into a pill", () => {
    expect(answerBlocks("Please name your starting place.")).toEqual([
      { kind: "para", text: "Please name your starting place." },
    ]);
    expect(answerBlocks("Intro.\nRoute status: blocked")[1]?.kind).toBe("para");
  });

  it("only a status note becomes a tag; other parentheticals stay in the step's words", () => {
    const [b] = answerBlocks(
      "1. Review two-way operation on Jalan A (6 mapped one-way detour segments; staff approval needed).\n2. Continue about 38 m (not checked yet).",
    );
    expect(b).toEqual({
      kind: "steps",
      steps: [
        {
          text: "Review two-way operation on Jalan A (6 mapped one-way detour segments; staff approval needed).",
        },
        { text: "Continue about 38 m.", note: "not checked yet" },
      ],
    });
  });

  it("tones: confirmed ok, blocked bad, a data gap never reads as blocked", () => {
    expect(statusTone("confirmed")).toBe("ok");
    expect(statusTone("blocked")).toBe("bad");
    expect(statusTone("No mapped connection (data gap)")).toBe("gap");
    expect(statusTone("likely OK (estimated from map data, not checked)")).toBe("warn");
    expect(statusTone("confirmed (demo values, not yet surveyed)")).toBe("warn");
  });
});

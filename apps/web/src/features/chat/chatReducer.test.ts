import type { ChatEvent } from "@tl/api-client";
import { describe, expect, it } from "vitest";
import { emptyAssistant, isRefusal, reduceChatEvent } from "./chatReducer";

const ev = (e: unknown) => e as ChatEvent;

describe("reduceChatEvent", () => {
  it("appends text deltas", () => {
    let m = emptyAssistant("a1");
    m = reduceChatEvent(m, ev({ type: "text.delta", delta: "Hel" }));
    m = reduceChatEvent(m, ev({ type: "text.delta", delta: "lo" }));
    expect(m.text).toBe("Hello");
  });
  it("tracks tool calls and marks them done by id", () => {
    let m = emptyAssistant("a1");
    m = reduceChatEvent(m, ev({ type: "tool.call", id: "t1", name: "plan_route", args: {} }));
    expect(m.tools).toEqual([{ id: "t1", name: "plan_route", done: false }]);
    m = reduceChatEvent(
      m,
      ev({ type: "tool.result", id: "t1", name: "plan_route", summary: "ok" }),
    );
    expect(m.tools[0]?.done).toBe(true);
  });
  it("collects citations, uncertainty, disclaimer and verification requests", () => {
    let m = emptyAssistant("a1");
    m = reduceChatEvent(
      m,
      ev({
        type: "citation",
        ref: 1,
        element_id: "e",
        attribute: "a",
        evidence_id: "x",
        status: "verified",
      }),
    );
    m = reduceChatEvent(
      m,
      ev({ type: "uncertainty", level: "partial", items: [{ what: "ramp" }] }),
    );
    m = reduceChatEvent(
      m,
      ev({ type: "disclaimer", lens: "flood", text: "Indicative", links: [] }),
    );
    m = reduceChatEvent(
      m,
      ev({
        type: "verification.requested",
        attribute: "a",
        created: true,
        demand: 1,
        element_id: "e",
        request_id: "r",
      }),
    );
    expect(m.citations).toHaveLength(1);
    expect(m.uncertainty?.level).toBe("partial");
    expect(m.disclaimer?.text).toBe("Indicative");
    expect(m.vrs).toHaveLength(1);
  });
  it("records errors and finishes on done", () => {
    let m = emptyAssistant("a1");
    m = reduceChatEvent(m, ev({ type: "error", code: "x", message: "boom" }));
    expect(m.error).toBe("boom");
    m = reduceChatEvent(
      m,
      ev({ type: "done", answer_status: "answered", message_id: "m", model: "mock" }),
    );
    expect(m.done).toBe(true);
  });
  it("does not mutate the input", () => {
    const m = emptyAssistant("a1");
    reduceChatEvent(m, ev({ type: "text.delta", delta: "x" }));
    expect(m.text).toBe("");
  });
});

describe("answer status", () => {
  it("keeps answer_status from the done event", () => {
    const m = reduceChatEvent(emptyAssistant("a"), {
      type: "done",
      message_id: "m",
      answer_status: "cannot_answer",
      model: "mock",
    } as never);
    expect(m.done).toBe(true);
    expect(m.answerStatus).toBe("cannot_answer");
    expect(isRefusal(m)).toBe(true);
  });
  it("an answered message is not a refusal; an errored one is not either", () => {
    const ok = reduceChatEvent(emptyAssistant("a"), {
      type: "done",
      message_id: "m",
      answer_status: "answered",
      model: "mock",
    } as never);
    expect(isRefusal(ok)).toBe(false);
    expect(isRefusal({ ...emptyAssistant("b"), error: "x", answerStatus: "cannot_answer" })).toBe(
      false,
    );
  });
});

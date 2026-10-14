import { describe, expect, it } from "vitest";
import { parseSse } from "./parseSse";

describe("parseSse", () => {
  it("splits complete events and keeps the remainder", () => {
    const { events, rest } = parseSse(
      'event: text.delta\ndata: {"type":"text.delta","delta":"Hi"}\n\nevent: done\ndata: {"ty',
    );
    expect(events).toEqual([{ event: "text.delta", data: '{"type":"text.delta","delta":"Hi"}' }]);
    expect(rest).toBe('event: done\ndata: {"ty');
  });
  it("handles CRLF", () => {
    const { events } = parseSse("event: done\r\ndata: {}\r\n\r\n");
    expect(events[0]?.event).toBe("done");
  });
  it("joins multi-line data and ignores comment/keepalive blocks", () => {
    const { events } = parseSse(": ping\n\nevent: x\ndata: a\ndata: b\n\n");
    expect(events).toEqual([{ event: "x", data: "a\nb" }]);
  });
});

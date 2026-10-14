export interface SseEvent {
  event: string;
  data: string;
}

/** Split a streaming buffer into complete SSE events plus the unfinished remainder. */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const norm = buffer.replace(/\r\n/g, "\n");
  const parts = norm.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: SseEvent[] = [];
  for (const block of parts) {
    if (!block) continue;
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0 && event === "message") continue; // comment / keep-alive block
    events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}

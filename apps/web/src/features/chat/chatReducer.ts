import type { ChatEvent, components } from "@tl/api-client";

/** `photo_url` is optional: present once the evidence behind the citation has a stored photo. */
export type Citation = components["schemas"]["Citation"] & { photo_url?: string | null };
export type Uncertainty = components["schemas"]["Uncertainty"];
export type Disclaimer = components["schemas"]["Disclaimer"];
export type VerificationRequested = components["schemas"]["VerificationRequested"];

export interface ToolChip {
  id: string;
  name: string;
  done: boolean;
}

export interface AssistantMessage {
  role: "assistant";
  id: string;
  text: string;
  tools: ToolChip[];
  citations: Citation[];
  uncertainty?: Uncertainty;
  disclaimer?: Disclaimer;
  vrs: VerificationRequested[];
  error?: string;
  done: boolean;
}

export interface UserMessage {
  role: "user";
  id: string;
  text: string;
}

export type ChatMessage = UserMessage | AssistantMessage;

export const emptyAssistant = (id: string): AssistantMessage => ({
  role: "assistant",
  id,
  text: "",
  tools: [],
  citations: [],
  vrs: [],
  done: false,
});

/** Pure reducer: fold one SSE event into the assistant message. scene.intent is handled by the caller. */
export function reduceChatEvent(m: AssistantMessage, ev: ChatEvent): AssistantMessage {
  switch (ev.type) {
    case "text.delta":
      return { ...m, text: m.text + ev.delta };
    case "tool.call":
      return { ...m, tools: [...m.tools, { id: ev.id, name: ev.name, done: false }] };
    case "tool.result":
      return { ...m, tools: m.tools.map((t) => (t.id === ev.id ? { ...t, done: true } : t)) };
    case "citation":
      return { ...m, citations: [...m.citations, ev] };
    case "uncertainty":
      return { ...m, uncertainty: ev };
    case "disclaimer":
      return { ...m, disclaimer: ev };
    case "verification.requested":
      return { ...m, vrs: [...m.vrs, ev] };
    case "error":
      return { ...m, error: ev.message };
    case "done":
      return { ...m, done: true };
    default:
      return m;
  }
}

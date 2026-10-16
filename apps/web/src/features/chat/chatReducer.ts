import type { ChatEvent, components } from "@tl/api-client";

export type Citation = components["schemas"]["Citation"];
export type Uncertainty = components["schemas"]["Uncertainty"];
export type Disclaimer = components["schemas"]["Disclaimer"];
export type VerificationRequested = components["schemas"]["VerificationRequested"];
export type AnswerCheck = components["schemas"]["AnswerCheck"];

export interface ToolChip {
  id: string;
  name: string;
  done: boolean;
}

export interface AssistantMessage {
  role: "assistant";
  id: string;
  text: string;
  /** Provisional summary while the model writes (answer.draft); replaced by the checked text. */
  draft: string;
  draftAttempt: number;
  /** One validator verdict per answer attempt (answer.check). */
  checks: AnswerCheck[];
  tools: ToolChip[];
  citations: Citation[];
  uncertainty?: Uncertainty;
  disclaimer?: Disclaimer;
  vrs: VerificationRequested[];
  error?: string;
  answerStatus?: string;
  /** done.model; "...+template" means the checked data was worded without the AI. */
  model?: string;
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
  draft: "",
  draftAttempt: 0,
  checks: [],
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
    case "answer.draft":
      // A new attempt (after the validator sent one back) starts a fresh draft.
      return ev.attempt === m.draftAttempt
        ? { ...m, draft: m.draft + ev.delta }
        : { ...m, draft: ev.delta, draftAttempt: ev.attempt };
    case "answer.check":
      return { ...m, checks: [...m.checks, ev], draft: ev.ok ? m.draft : "" };
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
      return { ...m, done: true, answerStatus: ev.answer_status, model: ev.model };
    default:
      return m;
  }
}

/** "I can't answer that yet" is a normal outcome, shown calmly; a transport error is not. */
export const isRefusal = (m: AssistantMessage): boolean =>
  !m.error && m.answerStatus === "cannot_answer";

/** The AI's answers were all sent back and the reply was built from the checked data alone. */
export const isTemplateFallback = (m: AssistantMessage): boolean =>
  m.done && (m.model ?? "").endsWith("+template");

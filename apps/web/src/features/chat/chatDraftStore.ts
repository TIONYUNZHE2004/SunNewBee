import { create } from "zustand";

/** A question to send now, with the persona and scenario it was asked under. */
export interface PendingAsk {
  text: string;
  /** Explicit persona; absent means the scene store's at send time. */
  profile?: string;
  /** Explicit scenario (null = none); undefined means the scene store's at send time. */
  scenarioId?: string | null;
}

interface ChatDraft {
  draft: string;
  setDraft: (t: string) => void;
  /** A question another feature wants sent now (for example the scenario bar). */
  pendingAsk: PendingAsk | null;
  ask: (text: string, opts?: Omit<PendingAsk, "text">) => void;
  clearAsk: () => void;
  /** Mirrors whether the chat panel is streaming an answer (the demo waits for it). */
  streaming: boolean;
  setStreaming: (s: boolean) => void;
}

/** Shared chat input text, so other features (place cards) can prefill the question. */
export const useChatDraft = create<ChatDraft>((set) => ({
  draft: "",
  setDraft: (draft) => set({ draft }),
  pendingAsk: null,
  ask: (text, opts) => set({ pendingAsk: { text, ...opts } }),
  clearAsk: () => set({ pendingAsk: null }),
  streaming: false,
  setStreaming: (streaming) => set({ streaming }),
}));

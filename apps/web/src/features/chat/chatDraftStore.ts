import { create } from "zustand";

interface ChatDraft {
  draft: string;
  setDraft: (t: string) => void;
  /** A question another feature wants sent now (for example the scenario bar). */
  pendingAsk: { text: string; n: number } | null;
  ask: (text: string) => void;
  clearAsk: () => void;
}

/** Shared chat input text, so other features (place cards) can prefill the question. */
export const useChatDraft = create<ChatDraft>((set) => ({
  draft: "",
  setDraft: (draft) => set({ draft }),
  pendingAsk: null,
  ask: (text) => set((s) => ({ pendingAsk: { text, n: (s.pendingAsk?.n ?? 0) + 1 } })),
  clearAsk: () => set({ pendingAsk: null }),
}));

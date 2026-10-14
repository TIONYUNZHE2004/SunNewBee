import { create } from "zustand";

/** Shared chat input text, so other features (place cards) can prefill the question. */
export const useChatDraft = create<{ draft: string; setDraft: (t: string) => void }>((set) => ({
  draft: "",
  setDraft: (draft) => set({ draft }),
}));

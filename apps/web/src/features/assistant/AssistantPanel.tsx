import { type FormEvent, useEffect, useRef } from "react";
import { useMode } from "../../app/modeStore";
import { Button } from "../../ui/Button";
import { useChatDraft } from "../chat/chatDraftStore";
import { useChatStream } from "../chat/useChatStream";
import { type Profile, useScene } from "../scene/sceneStore";
import { RisingRiverPanel } from "../whatif/RisingRiverPanel";
import { WhatIfLab } from "../whatif/WhatIfLab";
import { AnswerCard } from "./AnswerCard";
import { copyFor, STARTERS, type Starter } from "./starters";

export function AssistantPanel() {
  const mode = useMode((s) => s.mode);
  const copy = copyFor(mode);
  const starters = STARTERS[mode];
  const { messages, send, retry, streaming } = useChatStream();
  const text = useChatDraft((s) => s.draft);
  const setText = useChatDraft((s) => s.setDraft);
  const endRef = useRef<HTMLDivElement>(null);
  const pendingAsk = useChatDraft((s) => s.pendingAsk);

  const setStreamingMirror = useChatDraft((s) => s.setStreaming);
  useEffect(() => {
    setStreamingMirror(streaming);
  }, [streaming, setStreamingMirror]);
  useEffect(() => () => useChatDraft.getState().setStreaming(false), []);

  useEffect(() => {
    if (!pendingAsk || streaming) return;
    // Read the live store, not the render closure: StrictMode re-runs this effect with the same
    // closure, and the first run has already taken the ask.
    const ask = useChatDraft.getState().pendingAsk;
    if (!ask) return;
    // Hand over atomically so observers never see "nothing pending and not streaming".
    useChatDraft.setState({ pendingAsk: null, streaming: true });
    void send(ask.text, ask.profile as Profile | undefined, ask.scenarioId);
  }, [pendingAsk, streaming, send]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on any message change
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || streaming) return;
    void send(text);
    setText("");
  };

  const pick = (s: Starter) => {
    if (s.profile) useScene.getState().setProfile(s.profile);
    void send(s.text, s.profile);
  };

  return (
    <aside
      aria-label="Assistant"
      className="m-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border-2 border-edge bg-surface shadow-sm lg:m-3"
    >
      <header className="border-b border-edge px-4 py-3">
        <h1 className="text-lg font-semibold text-fg">{copy.title}</h1>
        <p className="mt-1 text-sm text-fg-soft">{copy.sub}</p>
      </header>
      {mode === "management" && (
        <>
          <WhatIfLab />
          <RisingRiverPanel />
        </>
      )}
      <div
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
      >
        {messages.length === 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wider text-fg-soft">TRY ASKING</p>
            <ul className="flex flex-col gap-2">
              {starters.map((s) => (
                <li key={s.text}>
                  <button
                    type="button"
                    disabled={streaming}
                    onClick={() => pick(s)}
                    className="flex min-h-[52px] w-full items-center justify-between gap-2 rounded-lg border border-edge bg-raised px-3 py-2 text-left text-sm text-fg hover:border-accent disabled:opacity-60"
                  >
                    {s.text}
                    <span aria-hidden="true">→</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <p key={m.id} className="ml-8 rounded-lg bg-accent px-3 py-2 text-sm text-on-accent">
              <span className="sr-only">You: </span>
              {m.text}
            </p>
          ) : (
            <AnswerCard key={m.id} m={m} onRetry={retry} />
          ),
        )}
        <div ref={endRef} />
      </div>
      <footer className="border-t border-edge p-3">
        {messages.length > 0 && (
          <div className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
            {starters.map((s) => (
              <button
                key={s.text}
                type="button"
                disabled={streaming}
                onClick={() => pick(s)}
                className="min-h-11 shrink-0 rounded-full border border-edge bg-raised px-3 text-xs text-fg hover:border-accent disabled:opacity-60"
              >
                {s.text}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={submit} className="flex gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Your question
          </label>
          <input
            id="chat-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={copy.placeholder}
            autoComplete="off"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-edge bg-raised px-3 text-sm text-fg"
          />
          <Button type="submit" disabled={streaming || !text.trim()}>
            Ask
          </Button>
        </form>
      </footer>
    </aside>
  );
}

import { type FormEvent, useEffect, useRef } from "react";
import { useMode } from "../../app/modeStore";
import { Icon } from "../../ui/icons";
import { useChatDraft } from "../chat/chatDraftStore";
import { useChatStream } from "../chat/useChatStream";
import { type Profile, useScene } from "../scene/sceneStore";
import { AnswerCard } from "./AnswerCard";
import { copyFor, STARTERS, type Starter } from "./starters";
import { TravelChip } from "./TravelChip";

/**
 * `compact` (bottom sheet at peek) hides everything but the composer with `hidden`, keeping the
 * conversation mounted. `flat` drops the panel's own glass because the sheet already has it.
 */
export function AssistantPanel({
  compact = false,
  flat = false,
}: {
  compact?: boolean;
  flat?: boolean;
}) {
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
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${flat ? "" : "glass rounded-2xl"}`}
    >
      <header className={`border-b border-edge px-4 py-3 ${compact ? "hidden" : ""}`}>
        <h1 className="text-lg font-semibold text-fg">{copy.title}</h1>
        <p className="mt-1 text-sm text-fg-soft">{copy.sub}</p>
      </header>
      <div
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className={`min-h-0 flex-1 overflow-y-auto p-3 ${compact ? "hidden" : ""}`}
      >
        <div className="flex flex-col gap-3">
          {messages.length === 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wider text-fg-soft">TRY ASKING</p>
              <ul className="grid grid-cols-2 gap-2">
                {starters.map((s) => (
                  <li key={s.text}>
                    <button
                      type="button"
                      disabled={streaming}
                      onClick={() => pick(s)}
                      className="flex h-full min-h-24 w-full flex-col items-start gap-2 rounded-xl border border-edge bg-raised p-3 text-left text-sm text-fg transition hover:-translate-y-px hover:border-accent disabled:opacity-60"
                    >
                      <span className="grid size-9 place-items-center rounded-lg bg-brand-tint text-accent">
                        <Icon name={s.icon} />
                      </span>
                      {s.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <p
                key={m.id}
                className="ml-10 self-end rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm text-on-accent"
              >
                <span className="sr-only">You: </span>
                {m.text}
              </p>
            ) : (
              <AnswerCard key={m.id} m={m} onRetry={retry} />
            ),
          )}
          <div ref={endRef} />
        </div>
      </div>
      <footer className="border-t border-edge p-3">
        {messages.length > 0 && (
          <div
            className={`-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1 ${compact ? "hidden" : ""}`}
          >
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
        {mode === "resident" && (
          <div className={`mb-2 ${compact ? "hidden" : ""}`}>
            <TravelChip />
          </div>
        )}
        <form
          onSubmit={submit}
          className="flex items-center gap-2 rounded-full border border-edge bg-raised p-1 pl-4 focus-within:border-accent"
        >
          <label htmlFor="chat-input" className="sr-only">
            Your question
          </label>
          <input
            id="chat-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={copy.placeholder}
            autoComplete="off"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-soft"
          />
          <button
            type="submit"
            aria-label="Ask"
            disabled={streaming || !text.trim()}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-on-accent transition hover:brightness-105 disabled:opacity-50"
          >
            <Icon name="send" />
          </button>
        </form>
      </footer>
    </aside>
  );
}

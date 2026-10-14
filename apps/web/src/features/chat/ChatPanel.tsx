import { type FormEvent, useEffect, useRef } from "react";
import { DisclaimerBanner } from "../flood/DisclaimerBanner";
import { CitationList } from "./CitationList";
import { useChatDraft } from "./chatDraftStore";
import type { AssistantMessage } from "./chatReducer";
import { UncertaintyBanner } from "./UncertaintyBanner";
import { useChatStream } from "./useChatStream";
import { useElementNames } from "./useElementNames";

const SUGGESTIONS = [
  "Can I get to the lakeside mall with a stroller?",
  "Where is the nearest evacuation centre if the water rises 3 m?",
  "Where can I drop off recycling nearby?",
];

function AssistantBubble({ m, onRetry }: { m: AssistantMessage; onRetry: () => void }) {
  const names = useElementNames();
  const waiting = !m.done && !m.text && !m.error;
  return (
    <div className="space-y-2 rounded-lg border border-line bg-card p-3">
      {m.tools.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Checks run">
          {m.tools.map((t) => (
            <li
              key={t.id}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-brand-tint px-2 py-0.5 text-xs"
            >
              {t.done ? (
                <span aria-hidden="true">✓</span>
              ) : (
                <span
                  aria-hidden="true"
                  className="inline-block size-3 motion-safe:animate-spin rounded-full border-2 border-brand border-t-transparent"
                />
              )}
              {t.name.replace(/_/g, " ")}
              <span className="sr-only">{t.done ? " done" : " running"}</span>
            </li>
          ))}
        </ul>
      )}
      {waiting && <p className="text-sm text-ink-soft">Thinking…</p>}
      {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}
      {m.uncertainty && <UncertaintyBanner u={m.uncertainty} />}
      {m.disclaimer && <DisclaimerBanner text={m.disclaimer.text} links={m.disclaimer.links} />}
      {m.citations.length > 0 && <CitationList citations={m.citations} names={names} />}
      {m.vrs.length > 0 && (
        <p className="text-sm text-ink-soft">
          {m.vrs.length === 1 ? "A check has" : `${m.vrs.length} checks have`} been requested from
          the township team.
        </p>
      )}
      {m.error && (
        <div role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm">
          <p>{m.error}</p>
          <button type="button" onClick={onRetry} className="mt-1 font-medium underline">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export function ChatPanel() {
  const { messages, send, retry, streaming } = useChatStream();
  const text = useChatDraft((s) => s.draft);
  const setText = useChatDraft((s) => s.setDraft);
  const endRef = useRef<HTMLDivElement>(null);

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

  return (
    <section
      aria-labelledby="chat-h"
      className="flex min-h-0 flex-col rounded-lg border border-line bg-paper"
    >
      <h2 id="chat-h" className="border-b border-line px-4 py-3 text-lg font-semibold">
        Ask about the township
      </h2>
      <div
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="min-h-48 flex-1 space-y-3 overflow-y-auto p-3 lg:max-h-[60vh]"
      >
        {messages.length === 0 && (
          <div>
            <p className="mb-2 text-sm text-ink-soft">Try a question:</p>
            <ul className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    disabled={streaming}
                    onClick={() => void send(s)}
                    className="min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-left text-sm text-brand hover:bg-brand-tint disabled:opacity-60"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <p key={m.id} className="ml-8 rounded-lg bg-brand px-3 py-2 text-white">
              <span className="sr-only">You: </span>
              {m.text}
            </p>
          ) : (
            <AssistantBubble key={m.id} m={m} onRetry={retry} />
          ),
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-line p-3">
        <label htmlFor="chat-input" className="sr-only">
          Your question
        </label>
        <input
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about routes, places or flooding"
          autoComplete="off"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-card px-3 text-sm"
        />
        <button
          type="submit"
          disabled={streaming || !text.trim()}
          className="min-h-11 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {streaming ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}

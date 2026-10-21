import { type FormEvent, useEffect, useRef, useState } from "react";
import { useMode } from "../../app/modeStore";
import { showsResidentTrip, useAssistantScope } from "../../lib/api";
import { Icon } from "../../ui/icons";
import { useChatDraft } from "../chat/chatDraftStore";
import { useChatStream } from "../chat/useChatStream";
import { ClosurePanel } from "../closures/ClosurePanel";
import { DayPanel } from "../day/DayPanel";
import { TripChip, TripPlanner } from "../day/TripPlanner";
import { quietStarters, useDevsimActive } from "../devsim/floodQuiet";
import { type Profile, useScene } from "../scene/sceneStore";
import { RisingRiverPanel } from "../whatif/RisingRiverPanel";
import { WhatIfLab } from "../whatif/WhatIfLab";
import { AnswerCard } from "./AnswerCard";
import { AttachBrief, BriefChip } from "./AttachBrief";
import { ChipRow } from "./ChipRow";
import { CoverageCard } from "./CoverageCard";
import { copyFor, DEVSIM_BRIEF, STARTERS, type Starter } from "./starters";
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
  const residentTrip = showsResidentTrip(useAssistantScope().data);
  const copy = copyFor(mode);
  // D11: no flood starters, chips or Rising river launcher while a Development Simulation runs.
  const devsim = useDevsimActive();
  const starters = devsim ? quietStarters(STARTERS[mode]) : STARTERS[mode];
  const { messages, send, retry, streaming } = useChatStream();
  const text = useChatDraft((s) => s.draft);
  const setText = useChatDraft((s) => s.setDraft);
  const endRef = useRef<HTMLDivElement>(null);
  const pendingAsk = useChatDraft((s) => s.pendingAsk);
  // Developer lens paperclip (Management only): the chosen file's name, never its contents (D5);
  // `sentFiles` maps a user message's index in the management thread to the file chip in its bubble.
  const [brief, setBrief] = useState<string | null>(null);
  const [sentFiles, setSentFiles] = useState<Record<number, string>>({});
  const attach = mode === "management";

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
    if (streaming) return;
    if (attach && brief) {
      // the attached brief is never read: the fixed brief text goes to /chat instead (D5)
      setSentFiles((m) => ({ ...m, [messages.length]: brief })); // attach is management-only
      setBrief(null);
      void send(DEVSIM_BRIEF);
      setText("");
      return;
    }
    if (!text.trim()) return;
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
      data-testid="assistant-panel"
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
        flat ? "" : "rounded-3xl border border-edge bg-surface shadow-[var(--c-shadow)]"
      }`}
    >
      <header className={`px-5 pt-5 pb-4 pr-14 ${compact ? "hidden" : ""}`}>
        <h1 className="m-0 text-xl font-semibold tracking-tight text-fg">{copy.title}</h1>
        <p className="mt-1 mb-0 text-sm text-fg-soft">{copy.sub}</p>
      </header>
      {/* the peeking phone sheet keeps only the composer: the trip card waits for more room.
          Scope B (T-011): the trip card shows only when the assistant covers everything. */}
      {mode === "resident" && residentTrip && (
        <div className={compact ? "hidden" : ""}>
          <TripPlanner />
        </div>
      )}
      {mode === "management" && (
        <>
          <DayPanel />
          <WhatIfLab />
          <ClosurePanel />
          {!devsim && <RisingRiverPanel />}
        </>
      )}
      <div
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className={`min-h-0 flex-1 overflow-y-auto border-t border-edge px-4 py-4 ${compact ? "hidden" : ""}`}
      >
        <div className="flex flex-col gap-3">
          {messages.length === 0 && (
            <div className="space-y-4">
              <p className="m-0 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-fg-soft">
                Try asking
              </p>
              <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0">
                {starters.map((s) => (
                  <li key={s.text}>
                    <button
                      type="button"
                      disabled={streaming}
                      onClick={() => pick(s)}
                      className="group flex h-full min-h-28 w-full flex-col items-start gap-3 rounded-2xl border border-edge bg-raised p-3.5 text-left text-sm leading-snug text-fg transition-[border-color,box-shadow,transform] hover:border-fg/25 hover:shadow-[var(--c-shadow)] motion-safe:hover:-translate-y-px disabled:opacity-60"
                    >
                      <span className="grid size-8 place-items-center rounded-full border border-edge bg-surface text-fg-soft transition-colors group-hover:text-fg">
                        <Icon name={s.icon} className="size-4" />
                      </span>
                      {s.text}
                    </button>
                  </li>
                ))}
              </ul>
              {mode === "resident" && <CoverageCard />}
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div
                key={m.id}
                className="ml-10 self-end rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-on-accent"
              >
                {attach && sentFiles[i] && (
                  <span className="mb-1.5 block">
                    <BriefChip name={sentFiles[i]} />
                  </span>
                )}
                <p className="m-0">
                  <span className="sr-only">You: </span>
                  {m.text}
                </p>
              </div>
            ) : (
              <AnswerCard key={m.id} m={m} onRetry={retry} />
            ),
          )}
          <div ref={endRef} />
        </div>
      </div>
      <footer className="border-t border-edge p-4">
        {messages.length > 0 && (
          <ChipRow className={compact ? "hidden" : ""}>
            {starters.map((s) => (
              <button
                key={s.text}
                type="button"
                disabled={streaming}
                onClick={() => pick(s)}
                className="min-h-9 shrink-0 rounded-full border border-edge bg-raised px-3 text-xs text-fg transition-colors hover:border-fg/25 disabled:opacity-60"
              >
                {s.text}
              </button>
            ))}
          </ChipRow>
        )}
        {mode === "resident" && (
          <div className={`mb-2 flex flex-wrap gap-2 ${compact ? "hidden" : ""}`}>
            <TravelChip />
            {residentTrip && <TripChip />}
          </div>
        )}
        {attach && brief && (
          <div className="mb-2">
            <BriefChip name={brief} onRemove={() => setBrief(null)} />
          </div>
        )}
        <form
          onSubmit={submit}
          className="flex items-center gap-2 rounded-2xl border border-edge bg-raised p-1.5 pl-4 transition-colors focus-within:border-fg/40 focus-within:bg-surface"
        >
          {attach && <AttachBrief onPick={setBrief} disabled={streaming} />}
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
            disabled={streaming || (!text.trim() && !(attach && brief))}
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-on-accent transition hover:opacity-90 disabled:opacity-40"
          >
            <Icon name="send" />
          </button>
        </form>
      </footer>
    </aside>
  );
}

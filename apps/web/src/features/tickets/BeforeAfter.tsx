import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useMode } from "../../app/modeStore";
import { Icon } from "../../ui/icons";
import { useChatDraft } from "../chat/chatDraftStore";
import type { Ticket } from "./ticketModel";

const PROFILE_WORDS: Record<string, { profile: string; label: string }> = {
  stroller: { profile: "stroller", label: "Stroller" },
  wheelchair: { profile: "wheelchair", label: "Wheelchair" },
  older_adult_rest: { profile: "older_adult_rest", label: "Older adult" },
};

/**
 * The server files route tickets as "<profile> route <A> -> <B>". Rebuild a question from those
 * endpoints so a replay asks what the ticket was about; anything else cannot be replayed truthfully.
 */
export function replayFor(summary: string): { text: string; profile: string } | undefined {
  const m = /^(\w+) route (.+?) -> (.+)$/i.exec(summary.trim());
  if (!m) return undefined;
  const p = PROFILE_WORDS[(m[1] ?? "").toLowerCase()];
  if (!p) return undefined;
  return { text: `${p.label} route from ${m[2]} to ${m[3]}`, profile: p.profile };
}

/** What residents saw before staff checked it, and what staff recorded after. */
export function BeforeAfter({ ticket }: { ticket: Ticket }) {
  const navigate = useNavigate();
  const [hl, setHl] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setHl(false), 1200);
    return () => clearTimeout(id);
  }, []);
  const r = ticket.resolution;
  const starter = replayFor(ticket.kind);
  const replay = () => {
    if (!starter) return;
    useMode.getState().setMode("resident");
    useChatDraft.getState().ask(starter.text, { profile: starter.profile });
    navigate("/");
  };
  return (
    <div>
      <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <section className="rounded-lg border border-dashed border-edge bg-raised p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-soft">Before</h3>
          {/* current_value is already the post-resolution value, so never show it here. */}
          <p className="mt-1 text-sm text-fg">Not checked yet</p>
        </section>
        <span className="hidden text-fg-soft sm:block">
          <Icon name="chevron" />
        </span>
        <section
          data-highlight={String(hl)}
          className={`rounded-lg border border-edge bg-accent p-4 text-on-accent motion-safe:transition-shadow ${hl ? "ring-2 ring-focus ring-offset-2 ring-offset-bg" : ""}`}
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide">Now</h3>
          <p className="mt-1 text-sm">
            {`Verified on ${r?.date ?? ""}${(r?.value ?? ticket.current) ? `: ${r?.value ?? ticket.current}` : ""}`}
          </p>
        </section>
      </div>
      {starter && (
        <div className="mt-3">
          <button
            type="button"
            onClick={replay}
            className="min-h-11 rounded-lg border border-edge px-4 text-sm font-semibold text-fg"
          >
            Ask the question again
          </button>
          <p className="mt-1 text-xs text-fg-soft">The next answer uses the checked fact.</p>
        </div>
      )}
    </div>
  );
}

import { useNavigate } from "react-router";
import { useMode } from "../../app/modeStore";
import { STARTERS } from "../assistant/starters";
import { useChatDraft } from "../chat/chatDraftStore";
import type { Ticket } from "./ticketModel";

function starterFor(kind: string) {
  if (kind.startsWith("Stroller route")) return STARTERS.resident[0];
  if (kind.startsWith("Wheelchair route")) return STARTERS.resident[1];
  return undefined;
}

/** What residents saw before staff checked it, and what staff recorded after. */
export function BeforeAfter({ ticket }: { ticket: Ticket }) {
  const navigate = useNavigate();
  const r = ticket.resolution;
  const starter = starterFor(ticket.kind);
  const replay = () => {
    if (!starter) return;
    useMode.getState().setMode("resident");
    useChatDraft.getState().ask(starter.text, { profile: starter.profile });
    navigate("/");
  };
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-lg border border-dashed border-edge bg-raised p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-soft">Before</h3>
          {/* current_value is already the post-resolution value, so never show it here. */}
          <p className="mt-1 text-sm text-fg">Not checked yet</p>
        </section>
        <section className="rounded-lg border border-edge bg-accent p-4 text-on-accent">
          <h3 className="text-xs font-semibold uppercase tracking-wide">Now</h3>
          <p className="mt-1 text-sm">
            {`Verified on ${r?.date ?? ""}${r?.value ? `: ${r.value}` : ""}`}
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
